import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { RagService } from './rag.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { QdrantModule } from '../vector-store/qdrant.module';
import { OllamaModule } from '../llm/ollama.module';
import { IndexingModule } from '../indexing/indexing.module';
import { UsersModule } from '../../users/users.module';
import { TeamsModule } from '../../teams/teams.module';
import { ProjectsModule } from '../../projects/projects.module';
import { TasksModule } from '../../tasks/tasks.module';
// Refactored services
import { ConversationService } from './services/conversation.service';
import { IntentClassificationService } from './services/intent-classification.service';
import { SearchService } from './services/search.service';
import { RetrievalService } from './services/retrieval.service';
import { GenerationService } from './services/generation.service';
import { ActionExecutionService } from './services/action-execution.service';
// Centralized utility services (DRY)
import { LLMCacheService } from './services/llm-cache.service';
import { EntityResolutionService } from './services/entity-resolution.service';
import { FormattingService } from './services/formatting.service';

@Module({
  imports: [
    EmbeddingsModule,
    QdrantModule,
    OllamaModule,
    IndexingModule, // ROOT FIX: For real-time index updates after CRUD
    CacheModule.register({
      ttl: 300000, // 5 minutes
      max: 100,
    }),
    // Entity modules for CRUD
    UsersModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
  ],
  providers: [
    RagService,
    // Centralized utility services (DRY - used by multiple services)
    LLMCacheService,
    EntityResolutionService,
    FormattingService,
    ConversationService,
    IntentClassificationService,
    SearchService,
    RetrievalService,
    GenerationService,
    ActionExecutionService,
  ],
  exports: [RagService],
})
export class RagModule {}
