import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Observable } from 'rxjs';
import { ChatRequestDto, ChatResponseDto } from '../dto/chat.dto';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantService } from '../vector-store/qdrant.service';
import { OllamaService } from '../llm/ollama.service';
import {
  ConversationService,
  ConversationHistory,
} from './services/conversation.service';
import { IntentClassificationService } from './services/intent-classification.service';
import { SearchService, RetrievedDoc } from './services/search.service';
import { RetrievalService } from './services/retrieval.service';
import { GenerationService } from './services/generation.service';
import { ActionExecutionService } from './services/action-execution.service';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantService: QdrantService,
    private readonly ollamaService: OllamaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    // Refactored services
    private readonly conversationService: ConversationService,
    private readonly intentClassificationService: IntentClassificationService,
    private readonly searchService: SearchService,
    private readonly retrievalService: RetrievalService,
    private readonly generationService: GenerationService,
    private readonly actionExecutionService: ActionExecutionService,
  ) {}

  async processQuery(request: ChatRequestDto): Promise<ChatResponseDto> {
    const startTime = Date.now();
    const steps: string[] = [];
    // Use provided sessionId or generate new one
    const sessionId =
      request.sessionId || this.conversationService.generateSessionId();

    // Generate cache key from query + filters
    const cacheKey = this.generateCacheKey(request.query);

    // Check cache first
    const cachedResult = await this.cacheManager.get<ChatResponseDto>(cacheKey);
    if (cachedResult) {
      this.logger.log(
        `🎯 CACHE HIT for query: "${request.query.substring(0, 50)}..."`,
      );
      return {
        ...cachedResult,
        sessionId, // Keep the conversation sessionId
        metadata: {
          ...cachedResult.metadata,
          fromCache: true,
          processingTime: Date.now() - startTime,
        },
      };
    }

    this.logger.log(`\n${'='.repeat(80)}`);
    this.logger.log(`🔵 NEW QUERY: "${request.query}"`);
    this.logger.log(`Session: ${sessionId}`);
    this.logger.log(`${'='.repeat(80)}\n`);

    try {
      // ===== QUICK INTENT CHECK (Greeting/Goodbye/Thank) =====
      // Get history first for context-aware quick intent detection
      const history = await this.conversationService.getHistory(sessionId);
      const quickIntent =
        await this.intentClassificationService.detectQuickIntent(
          request.query,
          history,
        );

      if (quickIntent.isQuick) {
        this.logger.log(`⚡ QUICK INTENT: ${quickIntent.type?.toUpperCase()}`);

        let answer = '';
        if (quickIntent.type === 'greeting') {
          answer = this.intentClassificationService.getGreetingTemplate();
        } else if (quickIntent.type === 'goodbye') {
          answer = this.intentClassificationService.getGoodbyeTemplate();
        } else if (quickIntent.type === 'thank') {
          answer = this.intentClassificationService.getThankYouTemplate();
        }

        // Update history
        await this.conversationService.addToHistory(
          sessionId,
          'user',
          request.query,
        );
        await this.conversationService.addToHistory(
          sessionId,
          'assistant',
          answer,
        );

        const processingTime = Date.now() - startTime;
        this.logger.log(`✅ QUICK RESPONSE in ${processingTime}ms\n`);

        return {
          answer,
          sources: [],
          confidence: 1.0,
          sessionId,
          metadata: {
            processingTime,
            stepsExecuted: ['quick_intent'],
            retrievedDocuments: 0,
            queryClassification: quickIntent.type || 'quick',
            fromCache: false,
          },
        };
      }

      // ===== STAGE 1: PRE-RETRIEVAL =====
      this.logger.log('📋 STAGE 1: PRE-RETRIEVAL');

      // Step 1.1: History Management (already fetched for quick intent check)
      steps.push('history_management');
      this.logger.log(`├─ History: ${history.length} messages`);

      // Step 1.2: Query Classification
      steps.push('query_classification');
      const classification =
        await this.intentClassificationService.classifyQuery(
          request.query,
          history,
        );
      this.logger.log(`├─ Classification: ${classification.type}`);
      this.logger.log(`├─ Intent: ${classification.intent}`);

      // Step 1.3: Metadata Filter Extraction (LLM-based entity detection)
      steps.push('metadata_extraction');
      const filters = await this.intentClassificationService.extractFilters(
        request.query,
        history,
        classification.type,
        classification.intent,
      );
      this.logger.log(
        `└─ Smart Filters (type=${classification.type}): ${JSON.stringify(filters)}\n`,
      );

      // ===== SPECIAL ROUTING: Handle different intent types =====

      // ROUTE 1: Actions (create/update/delete) → Function Calling WITH RETRIEVAL
      if (
        classification.type === 'create' ||
        classification.type === 'update' ||
        classification.type === 'delete'
      ) {
        this.logger.log(
          `\n🔧 ACTION DETECTED: ${classification.type.toUpperCase()}`,
        );
        // Actions don't need reformulation - just direct entity lookup
        this.logger.log('├─ Skipping reformulation for action query');
        this.logger.log('├─ Direct retrieval for entity resolution...');
        const actionDocs = await this.searchService.executeHybridSearch(
          [request.query], // Use original query only, no reformulation
          filters,
        );

        const actionResult = await this.actionExecutionService.executeAction(
          request.query,
          classification,
          sessionId,
          actionDocs, // Pass retrieved docs for entity resolution
          filters, // Pass filters for entity_types
        );

        // Update history
        await this.conversationService.addToHistory(
          sessionId,
          'user',
          request.query,
        );
        await this.conversationService.addToHistory(
          sessionId,
          'assistant',
          actionResult.answer,
        );

        const processingTime = Date.now() - startTime;
        this.logger.log(`✅ ACTION COMPLETED in ${processingTime}ms\n`);

        return {
          answer: actionResult.answer,
          sources: actionResult.sources || [],
          confidence: 1.0,
          sessionId,
          metadata: {
            processingTime,
            stepsExecuted: ['action_execution'],
            retrievedDocuments: 0,
            queryClassification: classification.type,
            fromCache: false,
            functionCalls: actionResult.functionCalls,
          },
        };
      }

      // ROUTE 2: Special intent types with targeted metadata filtering
      if (
        classification.type === 'requirements' ||
        classification.type === 'statistics' ||
        classification.type === 'help'
      ) {
        this.logger.log(
          `\n🎯 SPECIAL INTENT: ${classification.type.toUpperCase()} → Targeted Retrieval`,
        );
        // These will use specialized metadata filters in extractFilters()
      }

      // ROUTE 3: Normal RAG pipeline for search/question/list/status/analysis queries
      // NOW do reformulation (only for retrieval-heavy queries)
      this.logger.log(
        `\n🔍 RETRIEVAL QUERY: ${classification.type.toUpperCase()}`,
      );

      let reformulatedQueries: string[];

      // Always reformulate for question/search types OR complex queries
      const needsReformulation =
        classification.type === 'question' ||
        classification.type === 'search' ||
        request.query.length > 50 ||
        history.length > 0;

      if (needsReformulation) {
        steps.push('query_reformulation');
        this.logger.log('├─ Query reformulation for better retrieval...');
        reformulatedQueries =
          await this.intentClassificationService.reformulateQuery(
            request.query,
            history,
          );
        this.logger.log(
          `├─ Generated ${reformulatedQueries.length} search variations`,
        );
        reformulatedQueries.forEach((q, i) =>
          this.logger.log(`│  ${i + 1}. ${q}`),
        );
      } else {
        reformulatedQueries = [request.query];
        this.logger.log(`├─ Simple query - using original only`);
      }

      // SMART SHORTCUT: Check if this is a simple exact match query
      const isSimpleQuery = this.isSimpleExactMatch(request.query);
      if (isSimpleQuery && filters.entity_type) {
        this.logger.log('🚀 SMART SHORTCUT: Simple exact match detected');
        const shortcutResult = await this.executeSimpleShortcut(
          request.query,
          filters,
          sessionId,
          startTime,
          steps,
        );
        if (shortcutResult) {
          await this.cacheManager.set(cacheKey, shortcutResult, 300000);
          return shortcutResult;
        }
      }

      // ===== STAGE 2: RETRIEVAL =====
      this.logger.log('🔍 STAGE 2: RETRIEVAL');

      // Step 2.1: Hybrid Search (Vector + BM25) - Parallel Execution
      steps.push('hybrid_search');
      const globalDocs = await this.searchService.executeHybridSearch(
        reformulatedQueries,
        filters,
      );

      // ===== STAGE 3: POST-RETRIEVAL =====
      this.logger.log('⚡ STAGE 3: POST-RETRIEVAL');

      steps.push('reranking');
      steps.push('mmr_diversity');
      steps.push('context_compression');
      steps.push('citation_preparation');

      const { compressedDocs, sources, context } =
        this.retrievalService.processRetrievedDocs(globalDocs, request.query);

      // ===== STAGE 4: GENERATION =====
      this.logger.log('✨ STAGE 4: GENERATION');

      // Step 4.1: Answer Generation (with intent-aware prompts)
      steps.push('answer_generation');
      const answer = await this.generationService.generateAnswer(
        request.query,
        context,
        history,
        classification.type,
        classification.intent,
      );
      this.logger.log(
        `├─ Answer generated (${classification.type}): ${answer.substring(0, 100)}...`,
      );

      // Step 4.2: Grounding Check
      steps.push('grounding_check');
      const grounded = this.generationService.checkGrounding(
        answer,
        compressedDocs,
      );
      this.logger.log(`├─ Grounding check: ${grounded ? '✓' : '✗'}`);

      // Step 4.3: Confidence Scoring
      steps.push('confidence_scoring');
      const confidence = this.generationService.calculateConfidence(
        compressedDocs,
        grounded,
      );
      this.logger.log(`├─ Confidence: ${(confidence * 100).toFixed(1)}%`);

      // Step 4.4: Source Attribution
      steps.push('source_attribution');
      const attributedAnswer = this.generationService.attributeSources(
        answer,
        sources,
      );
      this.logger.log(`└─ Sources attributed\n`);

      // ===== STAGE 5: POST-GENERATION =====
      this.logger.log('💾 STAGE 5: POST-GENERATION');

      // Step 5.1: Update History
      steps.push('update_history');
      await this.conversationService.addToHistory(
        sessionId,
        'user',
        request.query,
      );
      await this.conversationService.addToHistory(
        sessionId,
        'assistant',
        attributedAnswer,
      );
      this.logger.log(`└─ History updated\n`);

      const processingTime = Date.now() - startTime;
      this.logger.log(`${'='.repeat(80)}`);
      this.logger.log(`✅ COMPLETED in ${processingTime}ms`);
      this.logger.log(`${'='.repeat(80)}\n`);

      const response: ChatResponseDto = {
        answer: attributedAnswer,
        sources,
        confidence,
        sessionId,
        metadata: {
          processingTime,
          stepsExecuted: steps,
          retrievedDocuments: compressedDocs.length,
          queryClassification: classification.type,
          fromCache: false,
        },
      };

      // Cache the result (exclude sessionId from cached data)
      await this.cacheManager.set(cacheKey, response, 300000); // 5 minutes TTL

      return response;
    } catch (error) {
      this.logger.error(`❌ Error processing query: ${error.message}`);

      // Format error message using LLM for user-friendly output
      const friendlyError = await this.generationService.formatErrorMessage(
        error.message,
        request.query,
      );

      const processingTime = Date.now() - startTime;

      return {
        answer: friendlyError,
        sources: [],
        confidence: 0,
        sessionId,
        metadata: {
          processingTime,
          stepsExecuted: ['error_handling'],
          retrievedDocuments: 0,
          queryClassification: 'error',
          fromCache: false,
        },
      };
    }
  }

  /**
   * Process query with streaming support (Phase 1.3)
   */
  processQueryStream(request: ChatRequestDto): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      (async () => {
        try {
          const startTime = Date.now();
          const sessionId = this.conversationService.generateSessionId();

          // Send initial event
          subscriber.next({
            data: JSON.stringify({ type: 'start', sessionId }),
          } as MessageEvent);

          // Get history
          const history = await this.conversationService.getHistory(sessionId);

          // Classification
          subscriber.next({
            data: JSON.stringify({
              type: 'status',
              message: 'Analyzing query...',
            }),
          } as MessageEvent);

          const classification =
            await this.intentClassificationService.classifyQuery(
              request.query,
              history,
            );

          // LLM-based reformulation (ALWAYS for streaming too)
          const isComplexQuery =
            request.query.length > 30 || history.length > 0;
          let reformulatedQueries: string[];

          if (isComplexQuery) {
            reformulatedQueries =
              await this.intentClassificationService.reformulateQuery(
                request.query,
                history,
              );
          } else {
            reformulatedQueries = [request.query];
          }

          // Extract filters (with history for context)
          const filters = await this.intentClassificationService.extractFilters(
            request.query,
            history,
            classification.type,
            classification.intent,
          );

          // Search
          subscriber.next({
            data: JSON.stringify({
              type: 'status',
              message: 'Searching database...',
            }),
          } as MessageEvent);

          const globalDocs = await this.searchService.executeHybridSearch(
            reformulatedQueries,
            filters,
          );

          const { compressedDocs, sources, context } =
            this.retrievalService.processRetrievedDocs(
              globalDocs,
              request.query,
            );

          // Send sources
          subscriber.next({
            data: JSON.stringify({ type: 'sources', sources }),
          } as MessageEvent);

          // Generate answer with streaming
          subscriber.next({
            data: JSON.stringify({
              type: 'status',
              message: 'Generating answer...',
            }),
          } as MessageEvent);

          let fullAnswer = '';

          const answer = await this.generationService.generateAnswerStream(
            request.query,
            context,
            history,
            (chunk) => {
              fullAnswer += chunk;
              subscriber.next({
                data: JSON.stringify({ type: 'chunk', text: chunk }),
              } as MessageEvent);
            },
          );

          const grounded = this.generationService.checkGrounding(
            answer,
            compressedDocs,
          );
          const confidence = this.generationService.calculateConfidence(
            compressedDocs,
            grounded,
          );

          // Update history
          await this.conversationService.addToHistory(
            sessionId,
            'user',
            request.query,
          );
          await this.conversationService.addToHistory(
            sessionId,
            'assistant',
            answer,
          );

          const processingTime = Date.now() - startTime;

          // Send complete event
          subscriber.next({
            data: JSON.stringify({
              type: 'complete',
              answer,
              sources,
              confidence,
              sessionId,
              metadata: {
                processingTime,
                retrievedDocuments: compressedDocs.length,
                queryClassification: classification.type,
              },
            }),
          } as MessageEvent);

          subscriber.complete();
        } catch (error) {
          subscriber.next({
            data: JSON.stringify({ type: 'error', message: error.message }),
          } as MessageEvent);
          subscriber.error(error);
        }
      })();
    });
  }

  private generateCacheKey(query: string): string {
    // Normalize query for better cache hits
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    // Use a simple hash for the cache key
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `query_${Math.abs(hash)}`;
  }

  // ===== SMART SHORTCUT METHODS (Phase 2.3) =====

  private isSimpleExactMatch(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    // Check for simple patterns like "get X", "show X", "list X" with specific filters
    const simplePatterns = [
      /^(get|show|find|list)\s+(all\s+)?(overdue|urgent|done|to do|in progress)/,
      /^(get|show|find|list)\s+(task|tasks|project|projects|team|teams|user|users)$/,
    ];

    return simplePatterns.some((pattern) => pattern.test(lowerQuery));
  }

  private async executeSimpleShortcut(
    query: string,
    filters: any,
    sessionId: string,
    startTime: number,
    steps: string[],
  ): Promise<ChatResponseDto | null> {
    try {
      // Direct vector search with high confidence threshold
      const embedding = await this.embeddingsService.generateEmbedding(query);

      // Build Qdrant filter
      const qdrantFilter: any = { must: [] };
      if (filters.entity_type) {
        qdrantFilter.must.push({
          key: 'entity_type',
          match: { value: filters.entity_type },
        });
      }
      if (filters['metadata.is_overdue']) {
        qdrantFilter.must.push({
          key: 'metadata.is_overdue',
          match: { value: true },
        });
      }
      if (filters['metadata.is_urgent']) {
        qdrantFilter.must.push({
          key: 'metadata.is_urgent',
          match: { value: true },
        });
      }
      if (filters['metadata.task_status']) {
        qdrantFilter.must.push({
          key: 'metadata.task_status',
          match: { value: filters['metadata.task_status'] },
        });
      }

      const collectionName = this.searchService.getCollectionName();
      const results = await this.qdrantService.searchVectors(
        collectionName,
        embedding,
        10,
        qdrantFilter.must.length > 0 ? qdrantFilter : undefined,
      );

      if (results.length > 0 && results[0].score > 0.8) {
        // High confidence match - skip full RAG pipeline
        const docs: RetrievedDoc[] = results.map((r) => ({
          id: r.id,
          score: r.score,
          text: r.payload.text || '',
          entityType: r.payload.entity_type || '',
          entityId: r.payload.entity_id || '',
          metadata: r.payload.metadata || {},
        }));

        const sources = this.retrievalService.prepareCitations(
          docs.slice(0, 5),
        );
        const context = this.retrievalService.buildContext(docs.slice(0, 5));

        // Use fast LLM for simple answer generation with caching
        const answer = await this.generationService.cachedLLMCall(
          `Based on this data, answer: ${query}\n\nData:\n${context}\n\nProvide a concise answer:`,
          this.ollamaService.getFastLlmModel(),
          { temperature: 0.3 },
        );

        const processingTime = Date.now() - startTime;

        this.logger.log(`✅ SHORTCUT COMPLETED in ${processingTime}ms\n`);

        return {
          answer: answer.trim(),
          sources,
          confidence: results[0].score,
          sessionId,
          metadata: {
            processingTime,
            stepsExecuted: ['shortcut_exact_match'],
            retrievedDocuments: docs.length,
            queryClassification: 'simple_shortcut',
            fromCache: false,
          },
        };
      }

      return null; // Fall back to full pipeline
    } catch (error) {
      this.logger.warn(
        `Shortcut failed: ${error.message}, using full pipeline`,
      );
      return null;
    }
  }
}
