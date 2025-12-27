import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { OllamaService } from '../../llm/ollama.service';

export interface LLMCallOptions {
  temperature?: number;
  system?: string;
  model?: string;
}

/**
 * Centralized LLM call service with caching support.
 * Eliminates duplicate cachedLLMCall implementations across services.
 */
@Injectable()
export class LLMCacheService {
  private readonly logger = new Logger(LLMCacheService.name);
  private readonly CACHE_TTL = 600000; // 10 minutes

  constructor(
    private readonly ollamaService: OllamaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Generate cache key from prompt and options
   */
  private generateCacheKey(
    prompt: string,
    model?: string,
    options?: LLMCallOptions,
  ): string {
    const hash = crypto
      .createHash('md5')
      .update(prompt + (model || '') + JSON.stringify(options || {}))
      .digest('hex');
    return `llm:${hash}`;
  }

  /**
   * Make a cached LLM call - 10x faster for repeated prompts
   */
  async cachedCall(prompt: string, options?: LLMCallOptions): Promise<string> {
    const model = options?.model || 'default';
    const temperature = options?.temperature || 0.7;
    const cacheKey = this.generateCacheKey(prompt, options?.model, options);

    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🤖 LLM CACHE SERVICE CALL`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Prompt length: ${prompt.length} chars`);
    this.logger.debug(`📥 INPUT - Model: ${model}`);
    this.logger.debug(`📥 INPUT - Temperature: ${temperature}`);
    this.logger.debug(`🔑 Cache key: ${cacheKey}`);

    // Check cache first
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(`⚡️ CACHE HIT - Returning cached response`);
      this.logger.debug(`📨 Cached response: "${cached.substring(0, 100)}..."`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      return cached;
    }

    this.logger.debug(`🔄 CACHE MISS - Calling LLM model...`);
    // Make LLM call
    const result = await this.ollamaService.generateCompletion(
      prompt,
      options?.model,
      {
        temperature: options?.temperature,
        system: options?.system,
      },
    );

    this.logger.debug(`✅ LLM call completed`);
    this.logger.debug(`📨 Response: "${result.substring(0, 150)}..."`);
    this.logger.debug(`💾 Caching response (TTL: ${this.CACHE_TTL}ms)`);

    // Cache the result
    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    this.logger.debug(`${'='.repeat(60)}\n`);
    return result;
  }

  /**
   * Make a cached LLM call with a specific model (convenience method)
   */
  async cachedCallWithModel(
    prompt: string,
    model: string,
    options?: Omit<LLMCallOptions, 'model'>,
  ): Promise<string> {
    return this.cachedCall(prompt, { ...options, model });
  }

  /**
   * Get the fast LLM model name (for quick operations)
   */
  getFastModel(): string {
    return this.ollamaService.getFastLlmModel();
  }

  /**
   * Get the default LLM model name
   */
  getDefaultModel(): string {
    return this.getFastModel();
  }
}
