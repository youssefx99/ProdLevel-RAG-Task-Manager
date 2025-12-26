import { Module } from '@nestjs/common';
import { QdrantModule } from './vector-store/qdrant.module';
import { OllamaModule } from './llm/ollama.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { IndexingModule } from './indexing/indexing.module';
import { RagModule } from './rag/rag.module';
import { AiController } from './ai.controller';
import { UsersModule } from '../users/users.module';
import { TeamsModule } from '../teams/teams.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    QdrantModule,
    OllamaModule,
    EmbeddingsModule,
    IndexingModule,
    RagModule,
    // Entity modules for CRUD operations
    UsersModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
  ],
  controllers: [AiController],
  exports: [
    QdrantModule,
    OllamaModule,
    EmbeddingsModule,
    IndexingModule,
    RagModule,
  ],
})
export class AiModule {}
