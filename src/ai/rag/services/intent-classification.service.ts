import { Injectable, Logger } from '@nestjs/common';
import { ConversationHistory } from './conversation.service';
import { LLMCacheService } from './llm-cache.service';
import { FormattingService } from './formatting.service';
import { EntityExtractionService } from './entity-extraction.service';
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
    private readonly entityExtractionService: EntityExtractionService,
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
  ): Promise<{ type: string; intent: string }> {
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

    // Use centralized prompt
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

      // Parse response
      const typeMatch = response.match(/type:\s*(\w+)/i);
      const intentMatch = response.match(/intent:\s*(\w+)/i);

      const type = typeMatch ? typeMatch[1].toLowerCase() : 'question';
      const intent = intentMatch ? intentMatch[1].toLowerCase() : 'general';

      this.logger.debug(`\n📦 PARSED OUTPUT:`);
      this.logger.debug(`   Type: "${type}"`);
      this.logger.debug(`   Intent: "${intent}"`);
      this.logger.debug(`${'='.repeat(60)}\n`);

      return { type, intent };
    } catch (error) {
      this.logger.error(`❌ Classification failed: ${error.message}`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      // Simplest fallback - treat as question
      return { type: 'question', intent: 'general' };
    }
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
      3,
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
   * ROOT FIX: LLM-based entity and filter extraction
   * Replaces brittle keyword matching with semantic understanding
   */
  async extractFilters(
    query: string,
    history: ConversationHistory[],
    type?: string,
    intent?: string,
  ): Promise<any> {
    const filters: any = {};

    // ==== SMART ROUTING: Different filters based on intent type ====

    // 1. REQUIREMENTS intent → filter to system_info metadata
    if (type === 'requirements') {
      filters.metadata = { type: 'system_info' };
      this.logger.debug('🎯 Requirements query → filtering to system_info');
      return filters;
    }

    // 2. STATISTICS intent → filter to statistics metadata
    if (type === 'statistics') {
      filters.metadata = { type: 'statistics' };
      this.logger.debug('🎯 Statistics query → filtering to statistics');
      return filters;
    }

    // 3. HELP intent → filter to system_info
    if (type === 'help') {
      filters.metadata = { type: 'system_info' };
      this.logger.debug('🎯 Help query → filtering to system_info');
      return filters;
    }

    // ROOT FIX: Use LLM to extract entity types semantically
    try {
      // Format history to string for entity extraction
      const historyContext = this.formattingService.formatHistoryCompact(
        history,
        3,
      );

      const entityTypes = await this.entityExtractionService.extractEntityTypes(
        query,
        historyContext,
      );

      if (entityTypes.length > 1) {
        filters.entity_types = entityTypes; // Array for multi-entity retrieval
        this.logger.debug(
          `🤖 LLM detected multi-entity: ${entityTypes.join(', ')}`,
        );
      } else if (entityTypes.length === 1) {
        filters.entity_type = entityTypes[0]; // Single entity
        this.logger.debug(`🤖 LLM detected entity: ${entityTypes[0]}`);
      }
    } catch (error) {
      this.logger.warn(
        `Entity extraction failed: ${error.message}, using fallback`,
      );
      // Fallback to intent-based detection
      if (intent === 'task_management') filters.entity_type = 'task';
      else if (intent === 'team_info') filters.entity_type = 'team';
      else if (intent === 'project_info') filters.entity_type = 'project';
      else if (intent === 'user_info') filters.entity_type = 'user';
    }

    // Status extraction (keep keyword-based for structured attributes)
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('overdue')) filters['metadata.is_overdue'] = true;
    if (lowerQuery.includes('urgent')) filters['metadata.is_urgent'] = true;
    if (lowerQuery.includes('to do')) filters['metadata.task_status'] = 'to do';
    if (lowerQuery.includes('in progress'))
      filters['metadata.task_status'] = 'in progress';
    if (lowerQuery.includes('done')) filters['metadata.task_status'] = 'done';

    return filters;
  }
}
