import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { Team } from './team.entity';
import { IndexingModule } from '../ai/indexing/indexing.module';

@Module({
  imports: [TypeOrmModule.forFeature([Team]), IndexingModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
