import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingsService } from '../../embeddings/embeddings.service';
import { QdrantService } from '../../vector-store/qdrant.service';

export interface RetrievedDoc {
  id: string;
  score: number;
  text: string;
  entityType: string;
  entityId: string;
  metadata: any;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly collectionName = 'task_manager';

  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantService: QdrantService,
  ) {}

  async vectorSearch(query: string, filters: any): Promise<RetrievedDoc[]> {
    const embedding = await this.embeddingsService.generateEmbedding(query);

    // Build Qdrant filter properly
    const qdrantFilter: any = { must: [] };

    if (filters.entity_type) {
      qdrantFilter.must.push({
        key: 'entity_type',
        match: { value: filters.entity_type },
      });
    }

    if (filters['metadata.is_overdue']) {
      qdrantFilter.must.push({
        key: 'metadata.is_overdue',
        match: { value: filters['metadata.is_overdue'] },
      });
    }

    if (filters['metadata.is_urgent']) {
      qdrantFilter.must.push({
        key: 'metadata.is_urgent',
        match: { value: filters['metadata.is_urgent'] },
      });
    }

    if (filters['metadata.task_status']) {
      qdrantFilter.must.push({
        key: 'metadata.task_status',
        match: { value: filters['metadata.task_status'] },
      });
    }

    const results = await this.qdrantService.searchVectors(
      this.collectionName,
      embedding,
      10,
      qdrantFilter.must.length > 0 ? qdrantFilter : undefined,
    );

    return results.map((r) => ({
      id: r.id,
      score: r.score,
      text: r.payload.text || '',
      entityType: r.payload.entity_type || '',
      entityId: r.payload.entity_id || '',
      metadata: r.payload.metadata || {},
    }));
  }

  async bm25Search(query: string, filters: any): Promise<RetrievedDoc[]> {
    // Simple keyword matching (BM25 approximation)
    const keywords = query.toLowerCase().split(/\s+/);

    // Get all documents (with pagination in production)
    const embedding = await this.embeddingsService.generateEmbedding(query);
    const allDocs = await this.qdrantService.searchVectors(
      this.collectionName,
      embedding,
      50,
    );

    // Score by keyword matches
    const scored = allDocs.map((doc) => {
      const text = (doc.payload.text || '').toLowerCase();
      const matches = keywords.filter((kw) => text.includes(kw)).length;
      const bm25Score = matches / keywords.length;

      return {
        id: doc.id,
        score: bm25Score,
        text: doc.payload.text || '',
        entityType: doc.payload.entity_type || '',
        entityId: doc.payload.entity_id || '',
        metadata: doc.payload.metadata || {},
      };
    });

    return scored.filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
  }

  reciprocalRankFusion(
    docLists: RetrievedDoc[][],
    k: number = 60,
  ): RetrievedDoc[] {
    const scoreMap = new Map<string, { doc: RetrievedDoc; score: number }>();

    for (const docs of docLists) {
      docs.forEach((doc, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        const existing = scoreMap.get(doc.id);

        if (existing) {
          existing.score += rrfScore;
        } else {
          scoreMap.set(doc.id, { doc, score: rrfScore });
        }
      });
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map((item) => ({ ...item.doc, score: item.score }));
  }

  async executeHybridSearch(
    reformulatedQueries: string[],
    filters: any,
  ): Promise<RetrievedDoc[]> {
    const allDocs: RetrievedDoc[] = [];

    // Execute all searches in parallel
    const searchPromises = reformulatedQueries.map(async (query) => {
      const [vectorDocs, bm25Docs] = await Promise.all([
        this.vectorSearch(query, filters),
        this.bm25Search(query, filters),
      ]);

      this.logger.log(
        `├─ Parallel search for "${query.substring(0, 50)}...": ${vectorDocs.length} vector + ${bm25Docs.length} BM25`,
      );

      // RRF per query
      return this.reciprocalRankFusion([vectorDocs, bm25Docs]);
    });

    const searchResults = await Promise.all(searchPromises);
    searchResults.forEach((mergedDocs, idx) => {
      this.logger.log(
        `├─ Query ${idx + 1} RRF merged: ${mergedDocs.length} docs`,
      );
      allDocs.push(...mergedDocs);
    });

    // Global RRF
    const globalDocs = this.reciprocalRankFusion([allDocs]);
    this.logger.log(`└─ Global RRF: ${globalDocs.length} unique docs\n`);

    return globalDocs;
  }

  getCollectionName(): string {
    return this.collectionName;
  }
}
