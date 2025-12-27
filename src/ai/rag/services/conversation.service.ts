import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { OllamaService } from '../../llm/ollama.service';

export interface ConversationHistory {
  role: 'user' | 'assistant' | 'summary';
  content: string;
  timestamp: Date;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private conversations = new Map<string, ConversationHistory[]>();
  private readonly MAX_MESSAGES = 10;
  private readonly SUMMARIZE_THRESHOLD = 8; // Summarize when we hit this many messages
  private readonly MAX_SUMMARY_TOKENS = 300;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(forwardRef(() => OllamaService))
    private ollamaService: OllamaService,
  ) {}

  async getHistory(sessionId: string): Promise<ConversationHistory[]> {
    this.logger.debug(`📖 Retrieving history for session: ${sessionId}`);
    // Check Redis cache first for fast retrieval
    const cacheKey = `history:${sessionId}`;

    try {
      const cached =
        await this.cacheManager.get<ConversationHistory[]>(cacheKey);
      if (cached) {
        this.logger.debug(`⚡ History cache HIT for session: ${sessionId}`);
        // Update in-memory map for consistency
        this.conversations.set(sessionId, cached);
        return cached;
      }
    } catch (error) {
      this.logger.warn(`Failed to get cached history: ${error.message}`);
    }

    // Fallback to in-memory map
    const history = this.conversations.get(sessionId) || [];
    this.logger.debug(
      `📋 Retrieved ${history.length} history entries for session`,
    );

    // Cache it for next time if not empty
    if (history.length > 0) {
      try {
        await this.cacheManager.set(cacheKey, history, 1800000); // 30 minutes TTL
      } catch (error) {
        this.logger.warn(`Failed to cache history: ${error.message}`);
      }
    }

    return history;
  }

  async addToHistory(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    this.logger.debug(`📝 Adding ${role} message to session: ${sessionId}`);
    if (!this.conversations.has(sessionId)) {
      this.logger.debug(`🆕 Creating new conversation session`);
      this.conversations.set(sessionId, []);
    }

    const history = this.conversations.get(sessionId)!;
    history.push({ role, content, timestamp: new Date() });

    // Summarize older messages when we hit the threshold
    if (history.length >= this.SUMMARIZE_THRESHOLD) {
      await this.summarizeOldMessages(sessionId, history);
    }

    // Keep only last MAX_MESSAGES as a safety net
    while (history.length > this.MAX_MESSAGES) {
      history.shift();
    }

    // Update cache for fast retrieval across requests
    const cacheKey = `history:${sessionId}`;
    try {
      await this.cacheManager.set(cacheKey, history, 1800000); // 30 minutes TTL
      this.logger.debug(
        `💾 Cached conversation history for session: ${sessionId}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to cache history update: ${error.message}`);
    }
  }

  private async summarizeOldMessages(
    sessionId: string,
    history: ConversationHistory[],
  ): Promise<void> {
    // Get messages to summarize (all except the last 2-3 recent ones)
    const messagesToKeep = 3;
    const messagesToSummarize = history.slice(0, -messagesToKeep);

    if (messagesToSummarize.length < 3) {
      return; // Not enough messages to summarize
    }

    this.logger.debug(
      `📋 Summarizing ${messagesToSummarize.length} messages for session: ${sessionId}`,
    );

    // Check if first message is already a summary
    const existingSummary =
      history[0]?.role === 'summary' ? history[0].content : '';

    // Build conversation text to summarize
    const conversationText = messagesToSummarize
      .filter((m) => m.role !== 'summary')
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    if (!conversationText.trim()) {
      return;
    }

    try {
      const summaryPrompt = `You are a conversation summarizer. Summarize the following conversation in a concise way, preserving key information, user requests, and important context. Keep the summary under 300 tokens.

${existingSummary ? `Previous summary: ${existingSummary}\n\n` : ''}New conversation to summarize:
${conversationText}

Provide a brief summary that captures:
1. Main topics discussed
2. Key user requests or questions
3. Important decisions or outcomes
4. Any relevant context for future messages

Summary:`;

      const summary = await this.ollamaService.generateCompletion(
        summaryPrompt,
        {
          maxTokens: this.MAX_SUMMARY_TOKENS,
          temperature: 0.3,
        },
      );

      // Replace old messages with summary + recent messages
      const recentMessages = history.slice(-messagesToKeep);
      history.length = 0; // Clear array

      // Add summary as first message
      history.push({
        role: 'summary',
        content: summary.trim(),
        timestamp: new Date(),
      });

      // Add back recent messages
      history.push(...recentMessages);

      this.logger.log(
        `✅ Summarized conversation for session: ${sessionId}. History reduced to ${history.length} entries.`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to summarize conversation: ${error.message}. Falling back to truncation.`,
      );
      // Fallback: just remove oldest messages
      while (history.length > this.MAX_MESSAGES) {
        history.shift();
      }
    }
  }

  getFormattedHistory(history: ConversationHistory[]): string {
    return history
      .map((h) => {
        if (h.role === 'summary') {
          return `[Previous conversation summary: ${h.content}]`;
        }
        return `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`;
      })
      .join('\n');
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
