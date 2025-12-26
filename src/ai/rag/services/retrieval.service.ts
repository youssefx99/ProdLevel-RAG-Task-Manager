import { Injectable, Logger } from '@nestjs/common';
import { RetrievedDoc } from './search.service';
import { Source } from '../../dto/chat.dto';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  async rerank(query: string, docs: RetrievedDoc[]): Promise<RetrievedDoc[]> {
    // Use LLM to rerank (or return as-is for now)
    // In production, use a cross-encoder model
    return docs.slice(0, 10); // Keep top 10
  }

  applyMMR(docs: RetrievedDoc[], lambda: number = 0.7): RetrievedDoc[] {
    if (docs.length === 0) return [];

    const selected: RetrievedDoc[] = [docs[0]];
    const remaining = docs.slice(1);

    while (selected.length < 5 && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const doc = remaining[i];

        // Calculate similarity with selected docs
        const maxSim = Math.max(
          ...selected.map((s) => this.textSimilarity(doc.text, s.text)),
        );

        // MMR score
        const mmrScore = lambda * doc.score - (1 - lambda) * maxSim;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return selected;
  }

  private textSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  compressContext(docs: RetrievedDoc[], maxTokens: number): RetrievedDoc[] {
    let totalLength = 0;
    const compressed: RetrievedDoc[] = [];

    for (const doc of docs) {
      const docLength = doc.text.length;
      if (totalLength + docLength <= maxTokens * 4) {
        compressed.push(doc);
        totalLength += docLength;
      } else {
        break;
      }
    }

    return compressed;
  }

  prepareCitations(docs: RetrievedDoc[]): Source[] {
    return docs.map((doc, idx) => ({
      entityType: doc.entityType,
      entityId: doc.entityId,
      text: doc.text.substring(0, 200) + '...',
      score: doc.score,
      citation: `[${idx + 1}]`,
    }));
  }

  buildContext(docs: RetrievedDoc[]): string {
    return docs
      .map(
        (doc, idx) =>
          `[${idx + 1}] ${doc.entityType.toUpperCase()}: ${doc.text}`,
      )
      .join('\n\n');
  }

  processRetrievedDocs(
    globalDocs: RetrievedDoc[],
    query: string,
  ): {
    rerankedDocs: RetrievedDoc[];
    diverseDocs: RetrievedDoc[];
    compressedDocs: RetrievedDoc[];
    sources: Source[];
    context: string;
  } {
    // Reranking
    const rerankedDocs = globalDocs.slice(0, 10); // Simplified rerank
    this.logger.log(`├─ Reranked: ${rerankedDocs.length} docs`);

    // MMR / Diversity Filtering (Conditional)
    let diverseDocs: RetrievedDoc[];
    if (rerankedDocs.length >= 5) {
      diverseDocs = this.applyMMR(rerankedDocs, 0.7);
      this.logger.log(`├─ MMR diversity: ${diverseDocs.length} docs`);
    } else {
      diverseDocs = rerankedDocs;
      this.logger.log(`├─ Skipping MMR (< 5 docs): ${diverseDocs.length} docs`);
    }

    // Context Compression
    const compressedDocs = this.compressContext(diverseDocs, 3000);
    this.logger.log(`├─ Context compressed to: ${compressedDocs.length} docs`);

    // Citation Preparation
    const sources = this.prepareCitations(compressedDocs);
    this.logger.log(`└─ Citations prepared: ${sources.length} sources\n`);

    // Build Context
    const context = this.buildContext(compressedDocs);

    return {
      rerankedDocs,
      diverseDocs,
      compressedDocs,
      sources,
      context,
    };
  }
}
