import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { IndexingService } from '../ai/indexing/indexing.service';

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

  async findAll(): Promise<Project[]> {
    return await this.projectRepository.find({
      relations: ['teams'],
      order: { createdAt: 'DESC' },
    });
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
}
