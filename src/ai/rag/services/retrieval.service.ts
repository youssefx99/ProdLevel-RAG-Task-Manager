import { Injectable, Logger } from '@nestjs/common';
import { RetrievedDoc } from './search.service';
import { Source } from '../../dto/chat.dto';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  async rerank(query: string, docs: RetrievedDoc[]): Promise<RetrievedDoc[]> {
    this.logger.debug(
      `🔄 Reranking ${docs.length} documents for query: "${query.substring(0, 50)}..."`,
    );
    // Use LLM to rerank (or return as-is for now)
    // In production, use a cross-encoder model
    const reranked = docs.slice(0, 10); // Keep top 10
    this.logger.debug(`✅ Rerank complete: ${reranked.length} docs kept`);
    return reranked;
  }

  applyMMR(docs: RetrievedDoc[], lambda: number = 0.85): RetrievedDoc[] {
    this.logger.debug(
      `🎯 Applying MMR to ${docs.length} docs (lambda=${lambda})`,
    );
    if (docs.length === 0) {
      this.logger.debug('⚠️ No documents to apply MMR');
      return [];
    }

    // Always keep the top-scored document first (guaranteed relevance)
    const selected: RetrievedDoc[] = [docs[0]];
    this.logger.debug(`│  MMR [1]: ${docs[0].text.substring(0, 50)}... (score: ${docs[0].score.toFixed(4)})`);
    
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

        // MMR score: higher lambda = more weight on relevance, less on diversity
        const mmrScore = lambda * doc.score - (1 - lambda) * maxSim;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    this.logger.debug(
      `✅ MMR complete: selected ${selected.length} diverse docs`,
    );
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
    this.logger.debug(
      `✂️ Compressing context: ${docs.length} docs, max ${maxTokens} tokens`,
    );
    let totalLength = 0;
    const compressed: RetrievedDoc[] = [];

    for (const doc of docs) {
      const docLength = doc.text.length;
      if (totalLength + docLength <= maxTokens * 4) {
        compressed.push(doc);
        totalLength += docLength;
      } else {
        this.logger.debug(`⚠️ Token limit reached at doc ${compressed.length}`);
        break;
      }
    }

    this.logger.debug(
      `✅ Compressed to ${compressed.length} docs (${totalLength} chars)`,
    );
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
    // Sort by score to ensure highest-relevance docs are first
    const sortedDocs = [...globalDocs].sort((a, b) => b.score - a.score);
    
    // Log top results for debugging
    this.logger.log(`📊 Top 3 after RRF sort:`);
    sortedDocs.slice(0, 3).forEach((doc, i) => {
      this.logger.log(`│  ${i + 1}. [${doc.entityType}] ${doc.text.substring(0, 60)}... (score: ${doc.score.toFixed(4)})`);
    });

    // Reranking - take top 10 sorted by score
    const rerankedDocs = sortedDocs.slice(0, 10);
    this.logger.log(`├─ Reranked: ${rerankedDocs.length} docs`);

    // MMR / Diversity Filtering (Conditional)
    // Use higher lambda (0.85) to favor relevance over diversity
    let diverseDocs: RetrievedDoc[];
    if (rerankedDocs.length >= 5) {
      diverseDocs = this.applyMMR(rerankedDocs, 0.85);
      this.logger.log(`├─ MMR diversity (λ=0.85): ${diverseDocs.length} docs`);
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
