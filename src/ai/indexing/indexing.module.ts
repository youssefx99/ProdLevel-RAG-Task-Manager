import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentTransformerService } from './document-transformer.service';
import { IndexingService } from './indexing.service';
import { User } from '../../users/user.entity';
import { Team } from '../../teams/team.entity';
import { Project } from '../../projects/project.entity';
import { Task } from '../../tasks/task.entity';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { QdrantModule } from '../vector-store/qdrant.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Team, Project, Task]),
    EmbeddingsModule,
    QdrantModule,
  ],
  providers: [DocumentTransformerService, IndexingService],
  exports: [DocumentTransformerService, IndexingService],
})
export class IndexingModule {}
