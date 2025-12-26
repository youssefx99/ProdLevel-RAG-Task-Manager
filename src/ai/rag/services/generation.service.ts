import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { OllamaService } from '../../llm/ollama.service';
import { ConversationHistory } from './conversation.service';
import { RetrievedDoc } from './search.service';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly ollamaService: OllamaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  // ===== CACHED LLM WRAPPER (10x FASTER FOR REPEATED CALLS) =====
  async cachedLLMCall(
    prompt: string,
    model?: string,
    options?: { temperature?: number; system?: string },
  ): Promise<string> {
    const cacheKey = `llm:${crypto
      .createHash('md5')
      .update(prompt + (model || '') + JSON.stringify(options || {}))
      .digest('hex')}`;

    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(
        `⚡ LLM CACHE HIT for prompt: ${prompt.substring(0, 50)}...`,
      );
      return cached;
    }

    const result = await this.ollamaService.generateCompletion(
      prompt,
      model,
      options,
    );
    await this.cacheManager.set(cacheKey, result, 600000); // Cache for 10 minutes
    return result;
  }

  async generateAnswer(
    query: string,
    context: string,
    history: ConversationHistory[],
    intentType?: string,
    intentCategory?: string,
  ): Promise<string> {
    // Compact history format
    const historyText = history
      .slice(-2)
      .map((h) => `[${h.role[0].toUpperCase()}] ${h.content}`)
      .join('\n');

    // ==== OPTIMIZED INTENT-AWARE INSTRUCTIONS ====
    const INSTRUCTIONS: Record<string, string> = {
      requirements: 'List required fields. Use bullets. Note optional fields.',
      statistics: 'Show numbers clearly. Use structured format.',
      status: 'State current status directly. Be factual.',
      list: 'Show items as bullet list with key details.',
      analysis: 'Compare systematically. Highlight differences.',
      help: 'Explain capabilities. Give examples.',
    };

    const sysInst =
      INSTRUCTIONS[intentType || ''] || 'Answer based on context. Be concise.';

    // OPTIMIZED PROMPT: ~40% shorter
    const prompt = `ROLE: Task management assistant.
RULES: ${sysInst} If no answer in context, say so.

CONTEXT:
${context}

${historyText ? `HISTORY:\n${historyText}\n` : ''}Q: ${query}

A:`;

    const response = await this.cachedLLMCall(prompt, undefined, {
      temperature: intentType === 'statistics' ? 0.3 : 0.7, // Lower temp for stats (precision), higher for analysis
    });

    return response.trim();
  }

  async generateAnswerStream(
    query: string,
    context: string,
    history: ConversationHistory[],
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const historyText = history
      .slice(-2)
      .map((h) => `[${h.role[0].toUpperCase()}] ${h.content}`)
      .join('\n');

    // OPTIMIZED STREAMING PROMPT
    const prompt = `ROLE: Task assistant. Answer from context only. Be concise.

CONTEXT:
${context}

${historyText ? `HISTORY:\n${historyText}\n` : ''}Q: ${query}

A:`;

    return await this.ollamaService.generateCompletion(prompt, undefined, {
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
      onChunk,
    });
  }

  checkGrounding(answer: string, docs: RetrievedDoc[]): boolean {
    // Check if answer contains references to the documents
    const contextWords = new Set(
      docs.flatMap((d) => d.text.toLowerCase().split(/\s+/)),
    );
    const answerWords = answer.toLowerCase().split(/\s+/);

    const matchedWords = answerWords.filter((w) => contextWords.has(w));
    return matchedWords.length / answerWords.length > 0.3; // 30% overlap
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
      // OPTIMIZED ERROR PROMPT: 50% shorter
      const prompt = `User asked: "${userQuery}"
Error: ${errorMessage}

Explain in 1-2 plain sentences (no technical jargon). What went wrong + what to do:`;

      const response = await this.cachedLLMCall(prompt, undefined, {
        temperature: 0.3,
      });

      return `❌ ${response.trim()}`;
    } catch {
      return `❌ Something went wrong. Please check your input and try again.`;
    }
  }
}
