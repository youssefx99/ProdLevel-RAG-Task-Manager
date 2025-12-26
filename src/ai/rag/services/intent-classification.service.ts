import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { OllamaService } from '../../llm/ollama.service';
import { ConversationHistory } from './conversation.service';

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
    private readonly ollamaService: OllamaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  // ===== CACHED LLM WRAPPER (10x FASTER FOR REPEATED CALLS) =====
  private async cachedLLMCall(
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
      const prompt = `Classify: "${query}"
Output ONE word: greeting|goodbye|thank|none`;

      try {
        const result = await this.cachedLLMCall(prompt, undefined, {
          temperature: 0,
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
    // Build compact history context
    const recentHistory = history.slice(-3);
    const historyContext = recentHistory.length
      ? recentHistory
          .map((h) => `[${h.role[0].toUpperCase()}] ${h.content}`)
          .join('\n')
      : '';

    // IMPROVED PROMPT: Distinguishes questions vs commands + handles assignments
    const prompt = `Classify the user's INTENT.

${historyContext ? `HISTORY:\n${historyContext}\n` : ''}MSG: "${query}"

CRITICAL DISTINCTION:
- COMMAND = User wants to DO something NOW ("delete X", "create a task", "assign X to Y")
- QUESTION = User is ASKING about something ("when was X created?", "who created X?")

TYPES:
- delete: COMMAND to remove entity ("delete user John", "remove this task")
- create: COMMAND to make new entity ("create a task", "add new user")  
- update: COMMAND to modify entity ("update task status", "change user email", "ASSIGN X to Y", "reassign task")
- question: QUESTION about entities ("when was user created?", "who made this?", "what is X?")
- search: Finding specific entity ("find user John", "show task #5")
- list: Show multiple entities ("list all users", "show tasks")
- statistics: Counts/numbers ("how many tasks?", "total users")

CRITICAL: "assign" = UPDATE operation!
- "assign task to John" → type: update
- "assign user to team" → type: update  
- "reassign project" → type: update

EXAMPLES:
- "when was seleman created?" → type: question (asking ABOUT creation time)
- "create user seleman" → type: create (COMMAND to create)
- "assign task to John" → type: update (COMMAND to update assignedTo)
- "delete the project" → type: delete (COMMAND)
- "who deleted the task?" → type: question (asking ABOUT deletion)

INTENT: task_management|user_info|team_info|project_info|general

Output:
type: [type]
intent: [intent]`;

    try {
      const response = await this.cachedLLMCall(prompt, undefined, {
        temperature: 0.1,
      });

      // Parse response
      const typeMatch = response.match(/type:\s*(\w+)/i);
      const intentMatch = response.match(/intent:\s*(\w+)/i);

      const type = typeMatch ? typeMatch[1].toLowerCase() : 'question';
      const intent = intentMatch ? intentMatch[1].toLowerCase() : 'general';

      this.logger.debug(`LLM Classification: type=${type}, intent=${intent}`);

      return { type, intent };
    } catch (error) {
      this.logger.error(`❌ Classification failed: ${error.message}`);
      // Simplest fallback - treat as question
      return { type: 'question', intent: 'general' };
    }
  }

  reformulateQuery(query: string, history: ConversationHistory[]): string[] {
    const queries = [query];
    const lowerQuery = query.toLowerCase();

    // Add contextual reformulation if history exists
    if (history.length > 0) {
      const lastMessage = history[history.length - 1];
      if (lastMessage.role === 'assistant') {
        queries.push(`${lastMessage.content} ${query}`);
      }
    }

    // Add entity-specific reformulations based on query keywords
    if (lowerQuery.includes('task')) {
      queries.push(`tasks related to: ${query}`);
    } else if (lowerQuery.includes('team')) {
      queries.push(`team information: ${query}`);
    } else if (lowerQuery.includes('project')) {
      queries.push(`project details: ${query}`);
    }

    return queries.slice(0, 3); // Max 3 variants
  }

  extractFilters(query: string, type?: string, intent?: string): any {
    const filters: any = {};

    const lowerQuery = query.toLowerCase();

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

    // Extract entity type from query or intent
    if (lowerQuery.includes('task') || intent === 'task_management') {
      filters.entity_type = 'task';
    } else if (lowerQuery.includes('team') || intent === 'team_info') {
      filters.entity_type = 'team';
    } else if (lowerQuery.includes('project') || intent === 'project_info') {
      filters.entity_type = 'project';
    } else if (
      lowerQuery.includes('user') ||
      lowerQuery.includes('member') ||
      intent === 'user_info'
    ) {
      filters.entity_type = 'user';
    }

    // Extract status
    if (lowerQuery.includes('overdue')) filters['metadata.is_overdue'] = true;
    if (lowerQuery.includes('urgent')) filters['metadata.is_urgent'] = true;
    if (lowerQuery.includes('to do')) filters['metadata.task_status'] = 'to do';
    if (lowerQuery.includes('in progress'))
      filters['metadata.task_status'] = 'in progress';
    if (lowerQuery.includes('done')) filters['metadata.task_status'] = 'done';

    return filters;
  }
}
