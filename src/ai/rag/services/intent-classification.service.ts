import { Injectable, Logger } from '@nestjs/common';
import { ConversationHistory } from './conversation.service';
import { LLMCacheService } from './llm-cache.service';
import { FormattingService } from './formatting.service';
import {
  buildQuickIntentPrompt,
  buildClassifyQueryPrompt,
  buildReformulateQueryPrompt,
} from '../../prompts';

@Injectable()
export class IntentClassificationService {
  private readonly logger = new Logger(IntentClassificationService.name);

  // Response templates for quick intents
  private readonly GREETING_TEMPLATES = [
    "Hello! I'm your task management assistant. How can I help you today?",
    'Hi there! Ready to help you manage your tasks and projects. What do you need?',
    "Hey! I'm here to assist with your task management. What would you like to know?",
    'Welcome! Ask me anything about your tasks, teams, or projects.',
    "Hello! I can help you find information, create tasks, and manage your projects. What's on your mind?",
  ];

  private readonly GOODBYE_TEMPLATES = [
    'Goodbye! Feel free to come back anytime you need help.',
    'See you later! Have a productive day!',
    "Take care! I'll be here whenever you need assistance.",
    'Bye! Hope I was helpful. Come back anytime!',
    'Goodbye! Wishing you success with your tasks!',
  ];

  private readonly THANK_YOU_TEMPLATES = [
    "You're welcome! Happy to help!",
    'Glad I could assist! Let me know if you need anything else.',
    'My pleasure! Feel free to ask if you have more questions.',
    "Anytime! I'm here to help whenever you need.",
    "You're welcome! Don't hesitate to reach out again!",
  ];

  constructor(
    private readonly llmCacheService: LLMCacheService,
    private readonly formattingService: FormattingService,
  ) {}

  // ===== QUICK INTENT DETECTION (Greeting/Goodbye/Thank) =====
  async detectQuickIntent(
    query: string,
    history: ConversationHistory[],
  ): Promise<{
    isQuick: boolean;
    type: 'greeting' | 'goodbye' | 'thank' | null;
  }> {
    // Fast regex-based detection first (no LLM needed for obvious cases)
    const lower = query.toLowerCase().trim();

    // Greeting patterns
    if (
      /^(hi|hello|hey|good\s*(morning|afternoon|evening)|howdy|greetings)\b/i.test(
        lower,
      )
    ) {
      return { isQuick: true, type: 'greeting' };
    }

    // Goodbye patterns
    if (/^(bye|goodbye|see\s*you|farewell|cya|later)\b/i.test(lower)) {
      return { isQuick: true, type: 'goodbye' };
    }

    // Thank patterns (only standalone thanks, not in task context)
    if (
      /^(thanks?|thank\s*you|appreciate|ty)\b/i.test(lower) &&
      lower.length < 30
    ) {
      return { isQuick: true, type: 'thank' };
    }

    // For ambiguous cases, use minimal LLM call
    if (lower.length < 50 && !/create|update|delete|add|remove/i.test(lower)) {
      const prompt = buildQuickIntentPrompt(query);

      try {
        const result = await this.llmCacheService.cachedCall(prompt, {
          temperature: 0.1,
        });
        const type = result.trim().toLowerCase() as
          | 'greeting'
          | 'goodbye'
          | 'thank';
        if (['greeting', 'goodbye', 'thank'].includes(type)) {
          return { isQuick: true, type };
        }
      } catch {
        // Silent fail, continue to regular classification
      }
    }

    return { isQuick: false, type: null };
  }

  getRandomTemplate(templates: string[]): string {
    return templates[Math.floor(Math.random() * templates.length)];
  }

  getGreetingTemplate(): string {
    return this.getRandomTemplate(this.GREETING_TEMPLATES);
  }

  getGoodbyeTemplate(): string {
    return this.getRandomTemplate(this.GOODBYE_TEMPLATES);
  }

  getThankYouTemplate(): string {
    return this.getRandomTemplate(this.THANK_YOU_TEMPLATES);
  }

  async classifyQuery(
    query: string,
    history: ConversationHistory[],
  ): Promise<{ type: string; intent: string; entities: string[] }> {
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🎯 QUERY CLASSIFICATION`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Query: "${query}"`);
    this.logger.debug(`📥 INPUT - History entries: ${history.length}`);

    // Use centralized formatting for history
    const historyContext = this.formattingService.formatHistoryCompact(
      history,
      10,
    );

    // Use centralized prompt (optimized: only type + entities)
    const prompt = buildClassifyQueryPrompt(query, historyContext);

    this.logger.debug(`\n📤 LLM PROMPT:`);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(prompt);
    this.logger.debug(`${'-'.repeat(60)}`);

    try {
      const response = await this.llmCacheService.cachedCall(prompt, {
        temperature: 0.2,
      });

      this.logger.debug(`\n📨 LLM RESPONSE:`);
      this.logger.debug(`${'-'.repeat(60)}`);
      this.logger.debug(response);
      this.logger.debug(`${'-'.repeat(60)}`);

      // Parse response (optimized: only type + entities)
      const typeMatch = response.match(/type:\s*(\w+)/i);
      const entitiesMatch = response.match(/entities:\s*\[([^\]]*)\]/i);

      const type = typeMatch ? typeMatch[1].toLowerCase() : 'question';

      // Parse entities array
      let entities: string[] = [];
      if (entitiesMatch && entitiesMatch[1]) {
        entities = entitiesMatch[1]
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(
            (e) =>
              e.length > 0 && ['user', 'task', 'team', 'project'].includes(e),
          );
      }

      // OPTIMIZED: Derive intent from type + entities (no LLM needed)
      const intent = this.deriveIntent(type, entities);

      this.logger.debug(`\n📦 PARSED OUTPUT:`);
      this.logger.debug(`   Type: "${type}"`);
      this.logger.debug(`   Intent: "${intent}" (derived)`);
      this.logger.debug(`   Entities: [${entities.join(', ')}]`);
      this.logger.debug(`${'='.repeat(60)}\n`);

      return { type, intent, entities };
    } catch (error) {
      this.logger.error(`❌ Classification failed: ${error.message}`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      // Simplest fallback - treat as question
      return { type: 'question', intent: 'general', entities: [] };
    }
  }

  /**
   * OPTIMIZED: Derive intent from type + entities
   * Eliminates redundant LLM output - intent is now computed, not extracted
   *
   * Logic:
   * - CRUD operations (create/update/delete) → {entity}_management
   * - Read operations (question/search/list) → {entity}_info
   * - No entity → 'general'
   */
  deriveIntent(type: string, entities: string[]): string {
    const primaryEntity = entities[0] || 'general';

    // CRUD operations use _management suffix
    if (['create', 'update', 'delete'].includes(type)) {
      return primaryEntity === 'general'
        ? 'general'
        : `${primaryEntity}_management`;
    }

    // Read operations use _info suffix
    if (['question', 'search', 'list', 'statistics'].includes(type)) {
      return primaryEntity === 'general' ? 'general' : `${primaryEntity}_info`;
    }

    return 'general';
  }

  /**
   * LLM-based query reformulation with keyword extraction
   * Generates 3-5 focused search queries for better retrieval
   */
  async reformulateQuery(
    query: string,
    history: ConversationHistory[],
  ): Promise<string[]> {
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🔄 QUERY REFORMULATION`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Query: "${query}"`);
    this.logger.debug(`📥 INPUT - History entries: ${history.length}`);

    // Always include original query first
    const queries = [query];

    // For simple queries (< 15 chars), skip LLM reformulation
    if (query.length < 15) {
      this.logger.debug(
        `⚠️ Query too short (${query.length} chars), skipping reformulation`,
      );
      this.logger.debug(`📤 OUTPUT - Queries: ["${query}"]`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      return queries;
    }

    // Build history context
    const historyContext = this.formattingService.formatHistoryCompact(
      history,
      10,
    );

    // Use centralized prompt
    const prompt = buildReformulateQueryPrompt(query, historyContext);

    this.logger.debug(`\n📤 LLM PROMPT:`);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(
      prompt.substring(0, 400) +
        (prompt.length > 400 ? '\n... (truncated)' : ''),
    );
    this.logger.debug(`${'-'.repeat(60)}`);

    try {
      const response = await this.llmCacheService.cachedCall(prompt, {
        temperature: 0.3,
      });

      this.logger.debug(`\n📨 LLM RESPONSE:`);
      this.logger.debug(`${'-'.repeat(60)}`);
      this.logger.debug(response);
      this.logger.debug(`${'-'.repeat(60)}`);

      // Parse LLM response - extract lines
      const variations = response
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 &&
            line.length < 100 &&
            !line.match(/^(output|input|example|task|rules):/i),
        )
        .slice(0, 4); // Max 4 variations

      if (variations.length > 0) {
        queries.push(...variations);
        this.logger.debug(`\n✅ Generated ${variations.length} variations:`);
        variations.forEach((v, i) => this.logger.debug(`   ${i + 1}. "${v}"`));
      }
    } catch (error) {
      this.logger.warn(`Reformulation failed: ${error.message}, using basic`);
      // Fallback to basic reformulation
      const lowerQuery = query.toLowerCase();
      if (lowerQuery.includes('task')) {
        queries.push(`tasks ${query}`);
      } else if (lowerQuery.includes('team')) {
        queries.push(`team ${query}`);
      } else if (lowerQuery.includes('project')) {
        queries.push(`project ${query}`);
      }
    }

    const finalQueries = queries.slice(0, 5); // Max 5 total (original + 4 variations)
    this.logger.debug(`\n📦 FINAL OUTPUT - ${finalQueries.length} queries:`);
    finalQueries.forEach((q, i) => this.logger.debug(`   ${i + 1}. "${q}"`));
    this.logger.debug(`${'='.repeat(60)}\n`);

    return finalQueries;
  }

  /**
   * OPTIMIZED: Extract filters based on classification results
   * Uses entities directly - no fallback needed since intent is derived from entities
   *
   * @param type - Query type (create/update/delete/question/search/list/statistics)
   * @param entities - Entity types from classification [user, task, team, project]
   */
  extractFilters(type: string, entities: string[]): any {
    const filters: any = {};

    // ==== SMART ROUTING: Different filters based on type ====

    // 1. STATISTICS type → filter to statistics metadata
    if (type === 'statistics') {
      filters.metadata = { type: 'statistics' };
      this.logger.debug('🎯 Statistics query → filtering to statistics');
      return filters;
    }

    // 2. HELP type → filter to system_info
    if (type === 'help' || type === 'requirements') {
      filters.metadata = { type: 'system_info' };
      this.logger.debug('🎯 Help/Requirements → filtering to system_info');
      return filters;
    }

    // Use entities directly for filtering
    if (entities.length > 0) {
      filters.entity_type = entities.length === 1 ? entities[0] : entities;
      this.logger.debug(
        `🎯 Entity filter: ${Array.isArray(filters.entity_type) ? filters.entity_type.join(', ') : filters.entity_type}`,
      );
    }

    return filters;
  }
}
