import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { IndexingService } from '../ai/indexing/indexing.service';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    private readonly indexingService: IndexingService,
  ) {}

  async create(createTeamDto: CreateTeamDto): Promise<Team> {
    const team = this.teamRepository.create(createTeamDto);
    const savedTeam = await this.teamRepository.save(team);

    // Auto-index to Qdrant
    try {
      await this.indexingService.indexTeam(savedTeam.id);
      this.logger.log(`✓ Team ${savedTeam.id} indexed to Qdrant`);
    } catch (error) {
      this.logger.warn(
        `Failed to index team ${savedTeam.id}: ${error.message}`,
      );
    }

    return savedTeam;
  }

  async findAll(): Promise<Team[]> {
    return await this.teamRepository.find({
      relations: ['owner', 'project', 'users'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Team> {
    const team = await this.teamRepository.findOne({
      where: { id },
      relations: ['owner', 'project', 'users'],
    });

    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }

    return team;
  }

  async update(id: string, updateTeamDto: UpdateTeamDto): Promise<Team> {
    const team = await this.findOne(id);
    Object.assign(team, updateTeamDto);
    const updatedTeam = await this.teamRepository.save(team);

    // Auto-reindex to Qdrant
    try {
      await this.indexingService.reindexEntity('team', updatedTeam.id);
      this.logger.log(`✓ Team ${updatedTeam.id} reindexed to Qdrant`);
    } catch (error) {
      this.logger.warn(
        `Failed to reindex team ${updatedTeam.id}: ${error.message}`,
      );
    }

    return updatedTeam;
  }

  async remove(id: string): Promise<void> {
    const team = await this.findOne(id);
    await this.teamRepository.remove(team);
  }
}
