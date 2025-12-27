import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface EmbeddingResponse {
  embedding: number[];
}

export interface CompletionResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

@Injectable()
export class OllamaService implements OnModuleInit {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  private readonly embeddingModel: string;
  private readonly llmModel: string;
  private readonly fastLlmModel: string;
  private readonly embeddingTimeout: number = 30000; // 30 seconds
  private readonly completionTimeout: number = 120000; // 120 seconds
  private readonly maxRetries: number = 3;

  // OpenAI configuration
  private readonly useOpenAI: boolean;
  private readonly openAIApiKey: string;
  private readonly openAIBaseUrl: string = 'https://api.openai.com/v1';
  private readonly openAIModel: string = 'gpt-4.1-nano-2025-04-14';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService.get<string>('OLLAMA_API_URL') ||
      'http://localhost:11434';
    this.embeddingModel =
      this.configService.get<string>('OLLAMA_EMBEDDING_MODEL') ||
      'nomic-embed-text';
    this.llmModel =
      this.configService.get<string>('OLLAMA_LLM_MODEL') || 'llama3:8b';
    this.fastLlmModel =
      this.configService.get<string>('OLLAMA_FAST_LLM_MODEL') || 'llama3.2:3b';

    // OpenAI configuration
    this.useOpenAI = this.configService.get<string>('USE_OPENAI') === '1';
    this.openAIApiKey = this.configService.get<string>('OPENAI_API_KEY') || '';

    if (this.useOpenAI) {
      this.logger.log('🔵 OpenAI mode enabled - using GPT for completions');
      if (!this.openAIApiKey) {
        this.logger.warn('⚠ USE_OPENAI=1 but OPENAI_API_KEY is not set!');
      }
    }
  }

  /**
   * Initialize and check Ollama health on module startup
   */
  async onModuleInit() {
    const isHealthy = await this.checkHealth();
    if (isHealthy) {
      await this.validateRequiredModels();
    }
  }

  /**
   * Check if Ollama service is running
   */
  async checkHealth(): Promise<boolean> {
    try {
      this.logger.debug(`🔍 Checking Ollama health at ${this.baseUrl}...`);

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/api/version`, {
          timeout: 5000,
        }),
      );

      this.logger.log(
        `✓ Ollama service is healthy (version: ${response.data.version || 'unknown'})`,
      );
      return true;
    } catch (error) {
      this.logger.error(`✗ Ollama service is not accessible: ${error.message}`);

      if (process.env.NODE_ENV === 'development') {
        this.logger.warn('⚠ Make sure Ollama is running: ollama serve');
      }

      return false;
    }
  }

  /**
   * List all available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/api/tags`, {
          timeout: 10000,
        }),
      );

      const models = response.data.models || [];
      const modelNames = models.map((model: OllamaModel) => model.name);

      this.logger.log(
        `Found ${modelNames.length} models: ${modelNames.join(', ')}`,
      );

      return modelNames;
    } catch (error) {
      this.logger.error(`Failed to list models: ${error.message}`);
      return [];
    }
  }

  /**
   * Validate that required models are available
   */
  private async validateRequiredModels(): Promise<void> {
    const models = await this.listModels();

    const requiredModels = [this.embeddingModel, this.llmModel];
    const missingModels = requiredModels.filter(
      (model) => !models.some((m) => m.includes(model.split(':')[0])),
    );

    if (missingModels.length > 0) {
      this.logger.warn(
        `⚠ Missing required models: ${missingModels.join(', ')}. ` +
          `Pull them with: ollama pull ${missingModels.join(' && ollama pull ')}`,
      );
    } else {
      this.logger.log(`✓ All required models are available`);
    }
  }

  /**
   * Check if a specific model exists
   */
  async checkModelExists(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    const modelBaseName = modelName.split(':')[0];
    return models.some((m) => m.includes(modelBaseName));
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const modelToUse = model || this.embeddingModel;

    try {
      this.logger.debug(
        `Generating embedding for text (${text.length} chars) with model ${modelToUse}`,
      );

      const response = await this.retryRequest(
        async () =>
          await firstValueFrom(
            this.httpService.post(
              `${this.baseUrl}/api/embeddings`,
              {
                model: modelToUse,
                prompt: text,
              },
              {
                timeout: this.embeddingTimeout,
              },
            ),
          ),
        3,
      );

      const embedding = (response as any).data.embedding;

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response format');
      }

      this.logger.debug(
        `✓ Generated embedding with ${embedding.length} dimensions`,
      );

      return embedding;
    } catch (error) {
      this.logger.error(`Failed to generate embedding: ${error.message}`);

      if (this.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(
          `Model "${modelToUse}" not found. Pull it with: ollama pull ${modelToUse}`,
        );
      }

      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateEmbeddingsBatch(
    texts: string[],
    model?: string,
  ): Promise<number[][]> {
    this.logger.log(`Generating embeddings for ${texts.length} texts...`);

    const embeddings: number[][] = [];
    const batchSize = 10; // Process 10 at a time with delays

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // Process batch sequentially with rate limiting
      for (const text of batch) {
        const embedding = await this.generateEmbedding(text, model);
        embeddings.push(embedding);

        // Small delay to avoid overwhelming Ollama
        await this.delay(100);
      }

      const progress = Math.min(i + batchSize, texts.length);
      this.logger.log(
        `Progress: ${progress}/${texts.length} embeddings generated`,
      );
    }

    this.logger.log(`✓ Successfully generated ${embeddings.length} embeddings`);
    return embeddings;
  }

  /**
   * Generate text completion with optional streaming
   */
  async generateCompletion(
    prompt: string,
    model?: string,
    options?: {
      temperature?: number;
      max_tokens?: number;
      system?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<string> {
    // Use OpenAI if enabled
    if (this.useOpenAI) {
      return this.generateCompletionOpenAI(prompt, options);
    }

    const modelToUse = model || this.llmModel;

    try {
      this.logger.debug(`Generating completion with model ${modelToUse}`);

      // Handle streaming
      if (options?.stream && options?.onChunk) {
        return await this.generateCompletionStream(prompt, modelToUse, options);
      }

      const response = await this.retryRequest(
        async () =>
          await firstValueFrom(
            this.httpService.post(
              `${this.baseUrl}/api/generate`,
              {
                model: modelToUse,
                prompt: prompt,
                stream: false,
                system: options?.system,
                options: {
                  temperature: options?.temperature ?? 0.7,
                  num_predict: options?.max_tokens ?? 1000,
                  num_thread: 0, // 0 = use all CPU cores
                  num_ctx: 2048, // Reduce context window for faster processing
                  num_batch: 512, // Larger batch size for parallel processing
                },
              },
              {
                timeout: this.completionTimeout,
              },
            ),
          ),
        2, // Fewer retries for completions
      );

      const completion = (response as any).data.response;

      if (!completion) {
        throw new Error('Invalid completion response format');
      }

      this.logger.debug(`✓ Generated completion (${completion.length} chars)`);

      return completion;
    } catch (error) {
      this.logger.error(`Failed to generate completion: ${error.message}`);

      if (this.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(
          `Model "${modelToUse}" not found. Pull it with: ollama pull ${modelToUse}`,
        );
      }

      throw error;
    }
  }

  /**
   * Generate streaming completion
   */
  private async generateCompletionStream(
    prompt: string,
    model: string,
    options: {
      temperature?: number;
      max_tokens?: number;
      system?: string;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<string> {
    // Use OpenAI streaming if enabled
    if (this.useOpenAI) {
      return this.generateCompletionStreamOpenAI(prompt, options);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/api/generate`,
          {
            model: model,
            prompt: prompt,
            stream: true,
            system: options.system,
            options: {
              temperature: options.temperature ?? 0.7,
              num_predict: options.max_tokens ?? 1000,
              num_thread: 0, // Use all CPU cores
              num_ctx: 2048, // Reduce context for speed
              num_batch: 512, // Parallel batch processing
            },
          },
          {
            timeout: this.completionTimeout,
            responseType: 'stream',
          },
        ),
      );

      let fullResponse = '';

      return new Promise((resolve, reject) => {
        (response as any).data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                fullResponse += data.response;
                if (options.onChunk) {
                  options.onChunk(data.response);
                }
              }

              if (data.done) {
                resolve(fullResponse);
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        });

        (response as any).data.on('error', (error: Error) => {
          reject(error);
        });

        (response as any).data.on('end', () => {
          resolve(fullResponse);
        });
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate streaming completion: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Generate streaming completion (deprecated - for backward compatibility)
   */
  async generateCompletionStreamLegacy(
    prompt: string,
    model?: string,
  ): Promise<string> {
    // For backward compatibility, just return the full completion
    this.logger.debug(
      'Legacy streaming method called, returning full completion',
    );
    return this.generateCompletion(prompt, model);
  }

  // ===== OPENAI COMPLETION METHODS =====

  /**
   * Generate completion using OpenAI API
   */
  private async generateCompletionOpenAI(
    prompt: string,
    options?: {
      temperature?: number;
      max_tokens?: number;
      system?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<string> {
    try {
      this.logger.debug(
        `Generating completion with OpenAI model ${this.openAIModel}`,
      );

      // Handle streaming
      if (options?.stream && options?.onChunk) {
        return await this.generateCompletionStreamOpenAI(prompt, options);
      }

      const messages: Array<{ role: string; content: string }> = [];

      // Add system message if provided
      if (options?.system) {
        messages.push({ role: 'system', content: options.system });
      }

      // Add user message
      messages.push({ role: 'user', content: prompt });

      const response = await this.retryRequest(
        async () =>
          await firstValueFrom(
            this.httpService.post(
              `${this.openAIBaseUrl}/chat/completions`,
              {
                model: this.openAIModel,
                messages: messages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.max_tokens ?? 200,
                stream: false,
              },
              {
                timeout: this.completionTimeout,
                headers: {
                  Authorization: `Bearer ${this.openAIApiKey}`,
                  'Content-Type': 'application/json',
                },
              },
            ),
          ),
        2,
      );

      const completion = (response as any).data.choices?.[0]?.message?.content;

      if (!completion) {
        throw new Error('Invalid OpenAI completion response format');
      }

      this.logger.debug(
        `✓ Generated OpenAI completion (${completion.length} chars)`,
      );

      return completion;
    } catch (error) {
      this.logger.error(
        `Failed to generate OpenAI completion: ${error.message}`,
      );

      if (this.isAxiosError(error) && error.response?.status === 401) {
        throw new Error(
          'Invalid OpenAI API key. Please check your OPENAI_API_KEY.',
        );
      }

      if (this.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`OpenAI model "${this.openAIModel}" not found.`);
      }

      throw error;
    }
  }

  /**
   * Generate streaming completion using OpenAI API
   */
  private async generateCompletionStreamOpenAI(
    prompt: string,
    options: {
      temperature?: number;
      max_tokens?: number;
      system?: string;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<string> {
    try {
      this.logger.debug(
        `Generating streaming completion with OpenAI model ${this.openAIModel}`,
      );

      const messages: Array<{ role: string; content: string }> = [];

      // Add system message if provided
      if (options?.system) {
        messages.push({ role: 'system', content: options.system });
      }

      // Add user message
      messages.push({ role: 'user', content: prompt });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.openAIBaseUrl}/chat/completions`,
          {
            model: this.openAIModel,
            messages: messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 200,
            stream: true,
          },
          {
            timeout: this.completionTimeout,
            responseType: 'stream',
            headers: {
              Authorization: `Bearer ${this.openAIApiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      let fullResponse = '';

      return new Promise((resolve, reject) => {
        (response as any).data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);

          for (const line of lines) {
            // Skip SSE comments and empty lines
            if (line.startsWith(':') || !line.startsWith('data: ')) {
              continue;
            }

            const jsonStr = line.replace('data: ', '').trim();

            // Check for stream end
            if (jsonStr === '[DONE]') {
              resolve(fullResponse);
              return;
            }

            try {
              const data = JSON.parse(jsonStr);
              const content = data.choices?.[0]?.delta?.content;

              if (content) {
                fullResponse += content;
                if (options.onChunk) {
                  options.onChunk(content);
                }
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        });

        (response as any).data.on('error', (error: Error) => {
          reject(error);
        });

        (response as any).data.on('end', () => {
          resolve(fullResponse);
        });
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate OpenAI streaming completion: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Retry a request with exponential backoff
   */
  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries: number,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await requestFn();
        return result;
      } catch (error) {
        lastError = error;

        // Don't retry on 404 (model not found) or 400 (bad request)
        if (
          this.isAxiosError(error) &&
          error.response &&
          [404, 400].includes(error.response.status)
        ) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.logger.warn(
            `Request failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
              `retrying in ${delay}ms...`,
          );
          await this.delay(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Type guard for Axios errors
   */
  private isAxiosError(error: any): error is AxiosError {
    return error.isAxiosError === true;
  }

  /**
   * Get base URL for advanced usage
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get configured models
   */
  getConfiguredModels(): { embedding: string; llm: string; fastLlm: string } {
    return {
      embedding: this.embeddingModel,
      llm: this.llmModel,
      fastLlm: this.fastLlmModel,
    };
  }

  /**
   * Get the fast LLM model name
   */
  getFastLlmModel(): string {
    return this.fastLlmModel;
  }
}
