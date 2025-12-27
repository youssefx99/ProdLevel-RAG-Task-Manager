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
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🔍 VECTOR SEARCH`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Query: "${query}"`);
    this.logger.debug(
      `📥 INPUT - Filters: ${JSON.stringify(filters, null, 2)}`,
    );

    const embedding = await this.embeddingsService.generateEmbedding(query);
    this.logger.debug(`📊 Generated embedding: ${embedding.length} dimensions`);
    this.logger.debug(
      `   First 5 values: [${embedding
        .slice(0, 5)
        .map((v) => v.toFixed(4))
        .join(', ')}...]`,
    );

    // Build Qdrant filter properly
    const qdrantFilter: any = { must: [] };
    let hasFilter = false;

    // Support both single entity_type and array of entity_types
    if (filters.entity_type) {
      if (Array.isArray(filters.entity_type)) {
        // Multiple entity types: use should (OR logic)
        // Qdrant requires should to be in a separate filter object
        qdrantFilter.should = filters.entity_type.map((type: string) => ({
          key: 'entity_type',
          match: { value: type },
        }));
        hasFilter = true;
      } else {
        // Single entity type
        qdrantFilter.must.push({
          key: 'entity_type',
          match: { value: filters.entity_type },
        });
        hasFilter = true;
      }
    }

    if (filters['metadata.is_overdue']) {
      qdrantFilter.must.push({
        key: 'metadata.is_overdue',
        match: { value: filters['metadata.is_overdue'] },
      });
      hasFilter = true;
    }

    if (filters['metadata.is_urgent']) {
      qdrantFilter.must.push({
        key: 'metadata.is_urgent',
        match: { value: filters['metadata.is_urgent'] },
      });
      hasFilter = true;
    }

    if (filters['metadata.task_status']) {
      qdrantFilter.must.push({
        key: 'metadata.task_status',
        match: { value: filters['metadata.task_status'] },
      });
      hasFilter = true;
    }

    // Clean up empty must array when using should
    if (qdrantFilter.must.length === 0) {
      delete qdrantFilter.must;
    }

    const results = await this.qdrantService.searchVectors(
      this.collectionName,
      embedding,
      10,
      hasFilter ? qdrantFilter : undefined,
    );

    this.logger.debug(`\n📤 OUTPUT - Found ${results.length} results:`);
    results.slice(0, 3).forEach((r, i) => {
      this.logger.debug(
        `  [${i + 1}] Score: ${r.score.toFixed(4)} | Type: ${r.payload.entity_type}`,
      );
      this.logger.debug(
        `      Text: "${(r.payload.text || '').substring(0, 80)}..."`,
      );
    });
    if (results.length > 3) {
      this.logger.debug(`  ... and ${results.length - 3} more results`);
    }
    this.logger.debug(`${'='.repeat(60)}\n`);

    return results.map((r) => ({
      id: r.id,
      score: r.score,
      text: r.payload.text || '',
      entityType: r.payload.entity_type || '',
      entityId: r.payload.entity_id || '',
      metadata: r.payload.metadata || {},
    }));
  }

  /**
   * BM25-style keyword search (improved)
   * ROOT FIX: Proper term frequency scoring without extra embedding call
   */
  async bm25Search(query: string, filters: any): Promise<RetrievedDoc[]> {
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`📝 BM25 KEYWORD SEARCH`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Query: "${query}"`);
    this.logger.debug(`📥 INPUT - Filters: ${JSON.stringify(filters)}`);

    // Extract keywords for BM25
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2); // Skip very short words

    this.logger.debug(`🔑 Extracted keywords: [${keywords.join(', ')}]`);
    if (keywords.length === 0) {
      this.logger.debug(`⚠️ No valid keywords for BM25`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      return [];
    }

    // Use Qdrant scroll to get documents matching filters (no embedding needed)
    try {
      const qdrantFilter: any = { must: [] };
      let hasFilter = false;

      if (filters.entity_type) {
        if (Array.isArray(filters.entity_type)) {
          // Multiple entity types: use should (OR logic)
          qdrantFilter.should = filters.entity_type.map((type: string) => ({
            key: 'entity_type',
            match: { value: type },
          }));
          hasFilter = true;
        } else {
          // Single entity type
          qdrantFilter.must.push({
            key: 'entity_type',
            match: { value: filters.entity_type },
          });
          hasFilter = true;
        }
      }

      // Clean up empty must array when using should
      if (qdrantFilter.must.length === 0) {
        delete qdrantFilter.must;
      }

      // Get documents via scroll (no embedding, just filter)
      const scrollResults = await this.qdrantService.scrollPoints(
        this.collectionName,
        hasFilter ? qdrantFilter : undefined,
        60, // Limit to 60 docs for BM25
      );

      // BM25-style scoring
      const k1 = 1.2; // Term saturation parameter
      const b = 0.75; // Length normalization

      const avgDocLength =
        scrollResults.reduce(
          (sum, doc) => sum + (doc.payload.text?.length || 0),
          0,
        ) / (scrollResults.length || 1);

      const scored = scrollResults.map((doc) => {
        const text = (doc.payload.text || '').toLowerCase();
        const docLength = text.length;

        // Calculate BM25 score
        let score = 0;
        for (const keyword of keywords) {
          const tf = (text.match(new RegExp(keyword, 'g')) || []).length;
          if (tf > 0) {
            // Simplified BM25 (without IDF for speed)
            const normalizedTf =
              (tf * (k1 + 1)) /
              (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
            score += normalizedTf;
          }
        }

        return {
          id: doc.id,
          score: score / keywords.length, // Normalize by query length
          text: doc.payload.text || '',
          entityType: doc.payload.entity_type || '',
          entityId: doc.payload.entity_id || '',
          metadata: doc.payload.metadata || {},
        };
      });

      const finalResults = scored
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      this.logger.debug(
        `\n📤 OUTPUT - BM25 found ${finalResults.length} results`,
      );
      finalResults.slice(0, 3).forEach((d, i) => {
        this.logger.debug(
          `  [${i + 1}] Score: ${d.score.toFixed(4)} | Type: ${d.entityType}`,
        );
        this.logger.debug(`      Text: "${d.text.substring(0, 80)}..."`);
      });
      this.logger.debug(`${'='.repeat(60)}\n`);

      return finalResults;
    } catch (error) {
      this.logger.error(`❌ BM25 search failed: ${error.message}`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      return [];
    }
  }

  reciprocalRankFusion(
    docLists: RetrievedDoc[][],
    k: number = 60,
  ): RetrievedDoc[] {
    this.logger.debug(
      `🔀 Running RRF on ${docLists.length} result lists (k=${k})`,
    );
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

    const fused = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map((item) => ({ ...item.doc, score: item.score }));

    this.logger.debug(`✅ RRF complete: ${fused.length} unique docs`);
    return fused;
  }

  async executeHybridSearch(
    reformulatedQueries: string[],
    filters: any,
  ): Promise<RetrievedDoc[]> {
    this.logger.debug(
      `🔍 Starting hybrid search with ${reformulatedQueries.length} queries`,
    );
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
