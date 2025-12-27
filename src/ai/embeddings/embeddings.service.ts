import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../llm/ollama.service';
import * as crypto from 'crypto';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly vectorDimension: number = 768; // nomic-embed-text dimension
  private readonly maxTextLength: number = 32000; // ~8192 tokens

  // Simple in-memory cache for embeddings (in production, use Redis)
  private embeddingCache: Map<string, number[]> = new Map();
  private readonly cacheTTL: number = 3600000; // 1 hour in milliseconds

  constructor(private readonly ollamaService: OllamaService) {}

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    this.logger.debug(
      `🔢 Generating embedding for text: "${text.substring(0, 50)}..."`,
    );
    // Preprocess text
    const processedText = this.preprocessText(text);
    this.logger.debug(
      `📏 Processed text length: ${processedText.length} chars`,
    );

    // Check cache first
    const cacheKey = this.generateCacheKey(processedText);
    const cachedEmbedding = this.getCachedEmbedding(cacheKey);

    if (cachedEmbedding) {
      this.logger.debug('✅ Using cached embedding');
      return cachedEmbedding;
    }

    // Generate new embedding
    this.logger.debug('🔄 Calling embedding model...');
    const embedding = await this.ollamaService.generateEmbedding(processedText);

    // Validate embedding
    if (!this.validateEmbedding(embedding)) {
      this.logger.error('❌ Generated embedding failed validation');
      throw new Error('Generated embedding failed validation');
    }

    this.logger.debug(`✅ Embedding generated: ${embedding.length} dimensions`);
    // Cache the result
    this.cacheEmbedding(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    this.logger.log(`Generating batch embeddings for ${texts.length} texts...`);

    const embeddings: number[][] = [];
    const processedTexts = texts.map((text) => this.preprocessText(text));

    // Process in batches of 10 with progress tracking
    const batchSize = 10;
    for (let i = 0; i < processedTexts.length; i += batchSize) {
      const batch = processedTexts.slice(i, i + batchSize);

      for (const text of batch) {
        // Check cache
        const cacheKey = this.generateCacheKey(text);
        let embedding = this.getCachedEmbedding(cacheKey);

        if (!embedding) {
          // Generate new embedding
          embedding = await this.ollamaService.generateEmbedding(text);

          if (!this.validateEmbedding(embedding)) {
            this.logger.warn(
              `Invalid embedding generated for text: ${text.substring(0, 50)}...`,
            );
            // Use zero vector as fallback
            embedding = new Array(this.vectorDimension).fill(0);
          }

          this.cacheEmbedding(cacheKey, embedding);
        }

        embeddings.push(embedding);
      }

      const progress = Math.min(i + batchSize, texts.length);
      this.logger.log(
        `Progress: ${progress}/${texts.length} embeddings generated`,
      );
    }

    this.logger.log(`✓ Batch embedding generation complete`);
    return embeddings;
  }

  /**
   * Preprocess text before embedding generation
   */
  preprocessText(text: string): string {
    if (!text || typeof text !== 'string') {
      this.logger.warn('Invalid text provided, using empty string');
      return '';
    }

    // 1. Trim whitespace
    let processed = text.trim();

    // 2. Normalize whitespace (replace multiple spaces/newlines with single space)
    processed = processed.replace(/\s+/g, ' ');

    // 3. Normalize unicode
    processed = processed.normalize('NFC');

    // 4. Check length and truncate if necessary
    if (processed.length > this.maxTextLength) {
      this.logger.warn(
        `Text exceeds max length (${processed.length} > ${this.maxTextLength}), truncating...`,
      );
      processed = processed.substring(0, this.maxTextLength);
    }

    // 5. Remove any null bytes or control characters (except newlines and tabs)
    processed = processed.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

    return processed;
  }

  /**
   * Validate that an embedding meets requirements
   */
  validateEmbedding(embedding: number[]): boolean {
    // Check if embedding exists and is an array
    if (!embedding || !Array.isArray(embedding)) {
      this.logger.error('Embedding is not an array');
      return false;
    }

    // Check dimension count
    if (embedding.length !== this.vectorDimension) {
      this.logger.error(
        `Invalid embedding dimension: expected ${this.vectorDimension}, got ${embedding.length}`,
      );
      return false;
    }

    // Check for NaN values
    if (embedding.some((val) => isNaN(val))) {
      this.logger.error('Embedding contains NaN values');
      return false;
    }

    // Check for all-zero vector (invalid embedding)
    const isAllZeros = embedding.every((val) => val === 0);
    if (isAllZeros) {
      this.logger.error('Embedding is all zeros (invalid)');
      return false;
    }

    // Check for infinity values
    if (embedding.some((val) => !isFinite(val))) {
      this.logger.error('Embedding contains infinity values');
      return false;
    }

    return true;
  }

  /**
   * Generate cache key from text using hash
   */
  private generateCacheKey(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * Get cached embedding if available and not expired
   */
  private getCachedEmbedding(cacheKey: string): number[] | null {
    const cached = this.embeddingCache.get(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for key: ${cacheKey.substring(0, 8)}...`);
      return cached;
    }

    return null;
  }

  /**
   * Cache an embedding with TTL
   */
  private cacheEmbedding(cacheKey: string, embedding: number[]): void {
    this.embeddingCache.set(cacheKey, embedding);

    // Set TTL - remove from cache after expiry
    setTimeout(() => {
      this.embeddingCache.delete(cacheKey);
      this.logger.debug(`Cache entry expired: ${cacheKey.substring(0, 8)}...`);
    }, this.cacheTTL);

    // Log cache size periodically
    if (this.embeddingCache.size % 100 === 0) {
      this.logger.log(
        `Embedding cache size: ${this.embeddingCache.size} entries`,
      );
    }
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    const size = this.embeddingCache.size;
    this.embeddingCache.clear();
    this.logger.log(`Cleared ${size} entries from embedding cache`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttl: number } {
    return {
      size: this.embeddingCache.size,
      ttl: this.cacheTTL,
    };
  }

  /**
   * Get expected vector dimension
   */
  getVectorDimension(): number {
    return this.vectorDimension;
  }
}
