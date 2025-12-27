import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { IndexingService } from '../ai/indexing/indexing.service';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    private readonly indexingService: IndexingService,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const taskData = { ...createTaskDto };
    if (!taskData.assignedTo) {
      delete taskData.assignedTo;
    }
    const task = this.taskRepository.create(taskData);
    const savedTask = await this.taskRepository.save(task);

    // Auto-index to Qdrant
    try {
      await this.indexingService.indexTask(savedTask.id);
      this.logger.log(`✓ Task ${savedTask.id} indexed to Qdrant`);
    } catch (error) {
      this.logger.warn(
        `Failed to index task ${savedTask.id}: ${error.message}`,
      );
    }

    return savedTask;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResult<Task>> {
    const skip = (page - 1) * limit;

    const [data, total] = await this.taskRepository.findAndCount({
      relations: ['assignee', 'assignee.team', 'assignee.team.project'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: ['assignee', 'assignee.team', 'assignee.team.project'],
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    const task = await this.findOne(id);

    // ROOT FIX: Clear the assignee relation when assignedTo changes
    // This ensures TypeORM properly updates the FK and doesn't cache stale relation
    if (updateTaskDto.assignedTo !== undefined) {
      // Clear the loaded relation so TypeORM uses the new FK value
      task.assignee = null as any;
    }

    Object.assign(task, updateTaskDto);
    const updatedTask = await this.taskRepository.save(task);

    // Auto-reindex to Qdrant
    try {
      await this.indexingService.reindexEntity('task', updatedTask.id);
      this.logger.log(`✓ Task ${updatedTask.id} reindexed to Qdrant`);
    } catch (error) {
      this.logger.warn(
        `Failed to reindex task ${updatedTask.id}: ${error.message}`,
      );
    }

    return updatedTask;
  }

  async remove(id: string): Promise<void> {
    const task = await this.findOne(id);
    await this.taskRepository.remove(task);
  }

  async count(): Promise<number> {
    return this.taskRepository.count();
  }
}
