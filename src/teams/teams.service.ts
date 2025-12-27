import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { IndexingService } from '../ai/indexing/indexing.service';
import { PaginatedResult } from '../common/dto/pagination.dto';

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

  async findAll(
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<PaginatedResult<Team>> {
    const skip = (page - 1) * limit;

    const queryBuilder = this.teamRepository
      .createQueryBuilder('team')
      .leftJoinAndSelect('team.owner', 'owner')
      .leftJoinAndSelect('team.project', 'project')
      .leftJoinAndSelect('team.users', 'users');

    if (search) {
      queryBuilder.where('team.name LIKE :search', {
        search: `%${search}%`,
      });
    }

    queryBuilder.orderBy('team.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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

  async count(): Promise<number> {
    return this.teamRepository.count();
  }
}
