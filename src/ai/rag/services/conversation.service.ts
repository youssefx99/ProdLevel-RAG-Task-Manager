import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

export interface ConversationHistory {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private conversations = new Map<string, ConversationHistory[]>();

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

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

    // Keep only last 10 messages
    if (history.length > 10) {
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

  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
