import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  Logger,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { IndexingService } from '../ai/indexing/indexing.service';

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly indexingService: IndexingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createProjectDto: CreateProjectDto) {
    const project = await this.projectsService.create(createProjectDto);

    try {
      await this.indexingService.indexProject(project.id);
      this.logger.debug(`📊 Indexed project: ${project.id}`);
    } catch (error) {
      this.logger.warn(`Failed to index project: ${error.message}`);
    }

    return project;
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    return this.projectsService.findAll(page, limit);
  }

  @Get('count')
  count() {
    return this.projectsService.count();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.update(id, updateProjectDto);

    try {
      await this.indexingService.reindexEntity('project', id);
      this.logger.debug(`📊 Reindexed project: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to reindex project: ${error.message}`);
    }

    return project;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.projectsService.remove(id);

    try {
      await this.indexingService.deleteFromIndex('project', id);
      this.logger.debug(`📊 Removed project from index: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to remove project from index: ${error.message}`);
    }
  }
}
