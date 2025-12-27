import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../../llm/ollama.service';
import { ConversationHistory } from './conversation.service';
import { RetrievedDoc } from './search.service';
import { LLMCacheService } from './llm-cache.service';
import { FormattingService } from './formatting.service';
import {
  buildGenerateAnswerPrompt,
  buildStreamAnswerPrompt,
  buildFormatErrorPrompt,
  getAnswerTemperature,
} from '../../prompts';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly llmCacheService: LLMCacheService,
    private readonly formattingService: FormattingService,
  ) {}

  /**
   * Cached LLM call - delegates to centralized LLMCacheService
   */
  async cachedLLMCall(
    prompt: string,
    model?: string,
    options?: { temperature?: number; system?: string },
  ): Promise<string> {
    return this.llmCacheService.cachedCall(prompt, { ...options, model });
  }

  async generateAnswer(
    query: string,
    context: string,
    history: ConversationHistory[],
    intentType?: string,
    intentCategory?: string,
  ): Promise<string> {
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🤖 GENERATE ANSWER`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Query: "${query}"`);
    this.logger.debug(`📥 INPUT - Context length: ${context.length} chars`);
    this.logger.debug(`📥 INPUT - History entries: ${history.length}`);
    this.logger.debug(`📥 INPUT - Intent: ${intentType || 'unknown'}`);

    // Log context preview
    this.logger.debug(`\n📄 CONTEXT PREVIEW:`);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(
      context.substring(0, 300) +
        (context.length > 300 ? '\n... (truncated)' : ''),
    );
    this.logger.debug(`${'-'.repeat(60)}`);

    // Use centralized formatting
    const historyText = this.formattingService.formatHistoryCompact(history, 2);

    // Use centralized prompt
    const prompt = buildGenerateAnswerPrompt(
      query,
      context,
      historyText,
      intentType,
    );

    this.logger.debug(`\n📤 LLM PROMPT (${prompt.length} chars):`);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(
      prompt.substring(0, 400) +
        (prompt.length > 400 ? '\n... (truncated)' : ''),
    );
    this.logger.debug(`${'-'.repeat(60)}`);

    const response = await this.cachedLLMCall(prompt, undefined, {
      temperature: getAnswerTemperature(intentType),
    });

    this.logger.debug(`\n📨 LLM RESPONSE:`);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(response);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(`${'='.repeat(60)}\n`);

    return response.trim();
  }

  async generateAnswerStream(
    query: string,
    context: string,
    history: ConversationHistory[],
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    // Use centralized formatting
    const historyText = this.formattingService.formatHistoryCompact(history, 2);

    // Use centralized prompt
    const prompt = buildStreamAnswerPrompt(query, context, historyText);

    return await this.ollamaService.generateCompletion(prompt, undefined, {
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
      onChunk,
    });
  }

  checkGrounding(answer: string, docs: RetrievedDoc[]): boolean {
    this.logger.debug(`🔍 Checking answer grounding...`);
    // Check if answer contains references to the documents
    const contextWords = new Set(
      docs.flatMap((d) => d.text.toLowerCase().split(/\s+/)),
    );
    const answerWords = answer.toLowerCase().split(/\s+/);

    const matchedWords = answerWords.filter((w) => contextWords.has(w));
    const overlap = matchedWords.length / answerWords.length;
    const isGrounded = overlap > 0.3; // 30% overlap
    this.logger.debug(
      `${isGrounded ? '✅' : '⚠️'} Grounding: ${(overlap * 100).toFixed(1)}% overlap`,
    );
    return isGrounded;
  }

  calculateConfidence(docs: RetrievedDoc[], grounded: boolean): number {
    if (docs.length === 0) return 0;

    const avgScore = docs.reduce((sum, d) => sum + d.score, 0) / docs.length;
    const groundingBonus = grounded ? 0.2 : 0;

    return Math.min(avgScore + groundingBonus, 1.0);
  }

  attributeSources(answer: string, sources: any[]): string {
    // Answer already has citations from LLM
    return answer;
  }

  /**
   * Format error messages using LLM for user-friendly output
   */
  async formatErrorMessage(
    errorMessage: string,
    userQuery: string,
  ): Promise<string> {
    try {
      // Use centralized prompt
      const prompt = buildFormatErrorPrompt(errorMessage, userQuery);

      const response = await this.cachedLLMCall(prompt, undefined, {
        temperature: 0.3,
      });

      return `❌ ${response.trim()}`;
    } catch {
      return `❌ Something went wrong. Please check your input and try again.`;
    }
  }
}
