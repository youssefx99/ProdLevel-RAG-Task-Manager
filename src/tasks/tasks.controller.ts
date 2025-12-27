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
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { IndexingService } from '../ai/indexing/indexing.service';

@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly indexingService: IndexingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createTaskDto: CreateTaskDto) {
    const task = await this.tasksService.create(createTaskDto);

    // Update vector database
    try {
      await this.indexingService.indexTask(task.id);
      this.logger.debug(`📊 Indexed task: ${task.id}`);
    } catch (error) {
      this.logger.warn(`Failed to index task: ${error.message}`);
    }

    return task;
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const search = query.search;
    return this.tasksService.findAll(page, limit, search);
  }

  @Get('count')
  count() {
    return this.tasksService.count();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateTaskDto: UpdateTaskDto) {
    const task = await this.tasksService.update(id, updateTaskDto);

    // Update vector database
    try {
      await this.indexingService.reindexEntity('task', id);
      this.logger.debug(`📊 Reindexed task: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to reindex task: ${error.message}`);
    }

    return task;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);

    // Remove from vector database
    try {
      await this.indexingService.deleteFromIndex('task', id);
      this.logger.debug(`📊 Removed task from index: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to remove task from index: ${error.message}`);
    }
  }
}
