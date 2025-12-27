import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { IndexingService } from '../ai/indexing/indexing.service';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly indexingService: IndexingService,
  ) {}

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    const project = this.projectRepository.create(createProjectDto);
    const savedProject = await this.projectRepository.save(project);

    // Auto-index to Qdrant
    try {
      await this.indexingService.indexProject(savedProject.id);
      this.logger.log(`✓ Project ${savedProject.id} indexed to Qdrant`);
    } catch (error) {
      this.logger.warn(
        `Failed to index project ${savedProject.id}: ${error.message}`,
      );
    }

    return savedProject;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<PaginatedResult<Project>> {
    const skip = (page - 1) * limit;

    const queryBuilder = this.projectRepository
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.teams', 'teams');

    if (search) {
      queryBuilder.where(
        '(project.name LIKE :search OR project.description LIKE :search)',
        { search: `%${search}%` },
      );
    }

    queryBuilder.orderBy('project.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Project> {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: ['teams', 'teams.users'],
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.findOne(id);
    Object.assign(project, updateProjectDto);
    const updatedProject = await this.projectRepository.save(project);

    // Auto-reindex to Qdrant
    try {
      await this.indexingService.reindexEntity('project', updatedProject.id);
      this.logger.log(`✓ Project ${updatedProject.id} reindexed to Qdrant`);
    } catch (error) {
      this.logger.warn(
        `Failed to reindex project ${updatedProject.id}: ${error.message}`,
      );
    }

    return updatedProject;
  }

  async remove(id: string): Promise<void> {
    const project = await this.findOne(id);
    await this.projectRepository.remove(project);
  }

  async count(): Promise<number> {
    return this.projectRepository.count();
  }
}
