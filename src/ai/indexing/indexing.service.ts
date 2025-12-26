import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTransformerService } from './document-transformer.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantService } from '../vector-store/qdrant.service';
import { User } from '../../users/user.entity';
import { Team } from '../../teams/team.entity';
import { Project } from '../../projects/project.entity';
import { Task } from '../../tasks/task.entity';

export interface IndexingStats {
  users: number;
  teams: number;
  projects: number;
  tasks: number;
  total: number;
  duration: number;
  errors: string[];
}

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);
  private readonly collectionName = 'task_manager';

  constructor(
    private readonly documentTransformer: DocumentTransformerService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantService: QdrantService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  /**
   * Index a single user
   */
  async indexUser(userId: string): Promise<void> {
    try {
      this.logger.debug(`Indexing user: ${userId}`);

      // Fetch user with all relations
      const user = await this.userRepository.findOne({
        where: { id: userId },
        relations: ['team', 'team.project', 'tasks'],
      });

      if (!user) {
        this.logger.warn(`User not found: ${userId}`);
        return;
      }

      // Transform to document
      const document = this.documentTransformer.transformUser(user);

      // Generate embedding
      const embedding = await this.embeddingsService.generateEmbedding(
        document.text,
      );

      // Prepare payload
      const payload = {
        entity_type: 'user',
        entity_id: user.id,
        text: document.text,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
        metadata: document.metadata,
        relationships: {
          team_id: user.teamId || null,
          project_id: user.team?.projectId || null,
        },
      };

      // Store in Qdrant
      const pointId = this.generatePointId('user', user.id);
      await this.qdrantService.insertVector(
        this.collectionName,
        pointId,
        embedding,
        payload,
      );

      this.logger.debug(`✓ Indexed user: ${user.name}`);
    } catch (error) {
      this.logger.error(`Failed to index user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Index a single team
   */
  async indexTeam(teamId: string): Promise<void> {
    try {
      this.logger.debug(`Indexing team: ${teamId}`);

      // Fetch team with all relations
      const team = await this.teamRepository.findOne({
        where: { id: teamId },
        relations: ['owner', 'project', 'users'],
      });

      if (!team) {
        this.logger.warn(`Team not found: ${teamId}`);
        return;
      }

      // Transform to document
      const document = this.documentTransformer.transformTeam(team);

      // Generate embedding
      const embedding = await this.embeddingsService.generateEmbedding(
        document.text,
      );

      // Prepare payload
      const payload = {
        entity_type: 'team',
        entity_id: team.id,
        text: document.text,
        created_at: team.createdAt.toISOString(),
        updated_at: team.updatedAt.toISOString(),
        metadata: document.metadata,
        relationships: {
          owner_id: team.ownerId || null,
          project_id: team.projectId || null,
        },
      };

      // Store in Qdrant
      const pointId = this.generatePointId('team', team.id);
      await this.qdrantService.insertVector(
        this.collectionName,
        pointId,
        embedding,
        payload,
      );

      this.logger.debug(`✓ Indexed team: ${team.name}`);
    } catch (error) {
      this.logger.error(`Failed to index team ${teamId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Index a single project
   */
  async indexProject(projectId: string): Promise<void> {
    try {
      this.logger.debug(`Indexing project: ${projectId}`);

      // Fetch project with all relations
      const project = await this.projectRepository.findOne({
        where: { id: projectId },
        relations: ['teams', 'teams.owner', 'teams.users'],
      });

      if (!project) {
        this.logger.warn(`Project not found: ${projectId}`);
        return;
      }

      // Transform to document
      const document = this.documentTransformer.transformProject(project);

      // Generate embedding
      const embedding = await this.embeddingsService.generateEmbedding(
        document.text,
      );

      // Prepare payload
      const payload = {
        entity_type: 'project',
        entity_id: project.id,
        text: document.text,
        created_at: project.createdAt.toISOString(),
        updated_at: project.updatedAt.toISOString(),
        metadata: document.metadata,
        relationships: {},
      };

      // Store in Qdrant
      const pointId = this.generatePointId('project', project.id);
      await this.qdrantService.insertVector(
        this.collectionName,
        pointId,
        embedding,
        payload,
      );

      this.logger.debug(`✓ Indexed project: ${project.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to index project ${projectId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Index a single task
   */
  async indexTask(taskId: string): Promise<void> {
    try {
      this.logger.debug(`Indexing task: ${taskId}`);

      // Fetch task with all relations
      const task = await this.taskRepository.findOne({
        where: { id: taskId },
        relations: ['assignee', 'assignee.team', 'assignee.team.project'],
      });

      if (!task) {
        this.logger.warn(`Task not found: ${taskId}`);
        return;
      }

      // Transform to document
      const document = this.documentTransformer.transformTask(task);

      // Generate embedding
      const embedding = await this.embeddingsService.generateEmbedding(
        document.text,
      );

      // Prepare payload
      const payload = {
        entity_type: 'task',
        entity_id: task.id,
        text: document.text,
        created_at: task.createdAt.toISOString(),
        updated_at: task.updatedAt.toISOString(),
        metadata: document.metadata,
        relationships: {
          assigned_to: task.assignedTo || null,
          team_id: task.assignee?.teamId || null,
          project_id: task.assignee?.team?.projectId || null,
        },
      };

      // Store in Qdrant
      const pointId = this.generatePointId('task', task.id);
      await this.qdrantService.insertVector(
        this.collectionName,
        pointId,
        embedding,
        payload,
      );

      this.logger.debug(`✓ Indexed task: ${task.title}`);
    } catch (error) {
      this.logger.error(`Failed to index task ${taskId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete an entity from the index
   */
  async deleteFromIndex(entityType: string, entityId: string): Promise<void> {
    try {
      const pointId = this.generatePointId(entityType, entityId);
      await this.qdrantService.deleteVector(this.collectionName, pointId);
      this.logger.debug(`✓ Deleted ${entityType} ${entityId} from index`);
    } catch (error) {
      this.logger.error(
        `Failed to delete ${entityType} ${entityId} from index: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Reindex an entity (delete and recreate)
   */
  async reindexEntity(entityType: string, entityId: string): Promise<void> {
    try {
      this.logger.debug(`Reindexing ${entityType}: ${entityId}`);

      // Delete old version
      try {
        await this.deleteFromIndex(entityType, entityId);
      } catch (error) {
        // If deletion fails because it doesn't exist, that's okay
        this.logger.debug(`Entity not in index yet, will create new entry`);
      }

      // Index new version based on entity type
      switch (entityType.toLowerCase()) {
        case 'user':
          await this.indexUser(entityId);
          break;
        case 'team':
          await this.indexTeam(entityId);
          break;
        case 'project':
          await this.indexProject(entityId);
          break;
        case 'task':
          await this.indexTask(entityId);
          break;
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }

      this.logger.log(`✓ Reindexed ${entityType}: ${entityId}`);
    } catch (error) {
      this.logger.error(
        `Failed to reindex ${entityType} ${entityId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Index all entities from database (internal method)
   */
  private async indexAllEntities(): Promise<IndexingStats> {
    const startTime = Date.now();
    const stats: IndexingStats = {
      users: 0,
      teams: 0,
      projects: 0,
      tasks: 0,
      total: 0,
      duration: 0,
      errors: [],
    };

    this.logger.log('Starting full indexing of all entities...');

    try {
      // Index users
      this.logger.log('Indexing users...');
      const users = await this.userRepository.find({
        relations: ['team', 'team.project', 'tasks'],
      });

      for (const user of users) {
        try {
          const document = this.documentTransformer.transformUser(user);
          const embedding = await this.embeddingsService.generateEmbedding(
            document.text,
          );
          const payload = {
            entity_type: 'user',
            entity_id: user.id,
            text: document.text,
            created_at: user.createdAt.toISOString(),
            updated_at: user.updatedAt.toISOString(),
            metadata: document.metadata,
            relationships: {
              team_id: user.teamId || null,
              project_id: user.team?.projectId || null,
            },
          };
          const pointId = this.generatePointId('user', user.id);
          await this.qdrantService.insertVector(
            this.collectionName,
            pointId,
            embedding,
            payload,
          );
          stats.users++;
        } catch (error) {
          stats.errors.push(`User ${user.id}: ${error.message}`);
          this.logger.warn(`Failed to index user ${user.id}: ${error.message}`);
        }
      }
      this.logger.log(`✓ Indexed ${stats.users}/${users.length} users`);

      // Index teams
      this.logger.log('Indexing teams...');
      const teams = await this.teamRepository.find({
        relations: ['owner', 'project', 'users'],
      });

      for (const team of teams) {
        try {
          const document = this.documentTransformer.transformTeam(team);
          const embedding = await this.embeddingsService.generateEmbedding(
            document.text,
          );
          const payload = {
            entity_type: 'team',
            entity_id: team.id,
            text: document.text,
            created_at: team.createdAt.toISOString(),
            updated_at: team.updatedAt.toISOString(),
            metadata: document.metadata,
            relationships: {
              owner_id: team.ownerId || null,
              project_id: team.projectId || null,
            },
          };
          const pointId = this.generatePointId('team', team.id);
          await this.qdrantService.insertVector(
            this.collectionName,
            pointId,
            embedding,
            payload,
          );
          stats.teams++;
        } catch (error) {
          stats.errors.push(`Team ${team.id}: ${error.message}`);
          this.logger.warn(`Failed to index team ${team.id}: ${error.message}`);
        }
      }
      this.logger.log(`✓ Indexed ${stats.teams}/${teams.length} teams`);

      // Index projects
      this.logger.log('Indexing projects...');
      const projects = await this.projectRepository.find({
        relations: ['teams', 'teams.owner', 'teams.users'],
      });

      for (const project of projects) {
        try {
          const document = this.documentTransformer.transformProject(project);
          const embedding = await this.embeddingsService.generateEmbedding(
            document.text,
          );
          const payload = {
            entity_type: 'project',
            entity_id: project.id,
            text: document.text,
            created_at: project.createdAt.toISOString(),
            updated_at: project.updatedAt.toISOString(),
            metadata: document.metadata,
            relationships: {},
          };
          const pointId = this.generatePointId('project', project.id);
          await this.qdrantService.insertVector(
            this.collectionName,
            pointId,
            embedding,
            payload,
          );
          stats.projects++;
        } catch (error) {
          stats.errors.push(`Project ${project.id}: ${error.message}`);
          this.logger.warn(
            `Failed to index project ${project.id}: ${error.message}`,
          );
        }
      }
      this.logger.log(
        `✓ Indexed ${stats.projects}/${projects.length} projects`,
      );

      // Index tasks
      this.logger.log('Indexing tasks...');
      const tasks = await this.taskRepository.find({
        relations: ['assignee', 'assignee.team', 'assignee.team.project'],
      });

      for (const task of tasks) {
        try {
          const document = this.documentTransformer.transformTask(task);
          const embedding = await this.embeddingsService.generateEmbedding(
            document.text,
          );
          const payload = {
            entity_type: 'task',
            entity_id: task.id,
            text: document.text,
            created_at: task.createdAt.toISOString(),
            updated_at: task.updatedAt.toISOString(),
            metadata: document.metadata,
            relationships: {
              assigned_to: task.assignedTo || null,
              team_id: task.assignee?.teamId || null,
              project_id: task.assignee?.team?.projectId || null,
            },
          };
          const pointId = this.generatePointId('task', task.id);
          await this.qdrantService.insertVector(
            this.collectionName,
            pointId,
            embedding,
            payload,
          );
          stats.tasks++;
        } catch (error) {
          stats.errors.push(`Task ${task.id}: ${error.message}`);
          this.logger.warn(`Failed to index task ${task.id}: ${error.message}`);
        }
      }
      this.logger.log(`✓ Indexed ${stats.tasks}/${tasks.length} tasks`);

      // Calculate totals
      stats.total = stats.users + stats.teams + stats.projects + stats.tasks;
      stats.duration = Date.now() - startTime;

      this.logger.log(`
✓ Indexing complete!
  Users:    ${stats.users}
  Teams:    ${stats.teams}
  Projects: ${stats.projects}
  Tasks:    ${stats.tasks}
  Total:    ${stats.total}
  Duration: ${(stats.duration / 1000).toFixed(2)}s
  Errors:   ${stats.errors.length}
      `);

      if (stats.errors.length > 0) {
        this.logger.warn(`Errors encountered: ${stats.errors.join(', ')}`);
      }

      return stats;
    } catch (error) {
      this.logger.error(`Full indexing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Index system information (DTOs, requirements, etc.)
   */
  async indexSystemInfo(): Promise<void> {
    try {
      this.logger.log('📋 Indexing system information...');

      const systemInfo = {
        // USER REQUIREMENTS (based on DTOs)
        user_requirements: {
          create: {
            required: ['name', 'email', 'password'],
            optional: ['role', 'teamId'],
            description:
              'To create a user, you need: name (full name), email (valid email), password (minimum 6 characters). Optionally: role (admin or member), teamId (UUID).',
          },
          update: {
            required: ['userId'],
            optional: ['name', 'email', 'password', 'role', 'teamId'],
            description:
              'To update a user, you need userId (UUID). You can update: name, email, password, role (admin/member), or teamId (UUID).',
          },
          delete: {
            required: ['userId'],
            description: 'To delete a user, you need userId (UUID).',
          },
        },

        // TASK REQUIREMENTS
        task_requirements: {
          create: {
            required: ['title', 'assignedTo'],
            optional: ['description', 'status', 'deadline'],
            description:
              'To create a task, you need: title (task name), assignedTo (user UUID). Optionally: description, status (todo/in_progress/done), deadline (ISO date).',
          },
          update: {
            required: ['taskId'],
            optional: [
              'title',
              'description',
              'status',
              'assignedTo',
              'deadline',
            ],
            description:
              'To update a task, you need taskId (UUID). You can update: title, description, status, assignedTo, or deadline.',
          },
          delete: {
            required: ['taskId'],
            description: 'To delete a task, you need taskId (UUID).',
          },
        },

        // TEAM REQUIREMENTS
        team_requirements: {
          create: {
            required: ['name', 'projectId', 'ownerId'],
            optional: [],
            description:
              'To create a team, you need: name (team name), projectId (UUID), ownerId (user UUID who will own the team).',
          },
          update: {
            required: ['teamId'],
            optional: ['name', 'projectId', 'ownerId'],
            description:
              'To update a team, you need teamId (UUID). You can update: name, projectId, or ownerId.',
          },
          delete: {
            required: ['teamId'],
            description: 'To delete a team, you need teamId (UUID).',
          },
        },

        // PROJECT REQUIREMENTS
        project_requirements: {
          create: {
            required: ['name'],
            optional: ['description'],
            description:
              'To create a project, you need: name (project name). Optionally: description.',
          },
          update: {
            required: ['projectId'],
            optional: ['name', 'description'],
            description:
              'To update a project, you need projectId (UUID). You can update: name or description.',
          },
          delete: {
            required: ['projectId'],
            description: 'To delete a project, you need projectId (UUID).',
          },
        },
      };

      const text = `System Information and Requirements:

USER OPERATIONS:
- Create User: Required fields are name, email, and password (minimum 6 characters). Optional fields are role (admin or member) and teamId.
- Update User: Required field is userId. You can update name, email, password, role, or teamId.
- Delete User: Required field is userId.

TASK OPERATIONS:
- Create Task: Required fields are title and assignedTo (user UUID). Optional fields are description, status (todo, in_progress, done), and deadline.
- Update Task: Required field is taskId. You can update title, description, status, assignedTo, or deadline.
- Delete Task: Required field is taskId.

TEAM OPERATIONS:
- Create Team: Required fields are name, projectId, and ownerId (user who owns the team).
- Update Team: Required field is teamId. You can update name, projectId, or ownerId.
- Delete Team: Required field is teamId.

PROJECT OPERATIONS:
- Create Project: Required field is name. Optional field is description.
- Update Project: Required field is projectId. You can update name or description.
- Delete Project: Required field is projectId.

IMPORTANT NOTES:
- All IDs (userId, taskId, teamId, projectId, assignedTo, ownerId) must be UUIDs
- Passwords must be at least 6 characters long
- Email addresses must be valid email format
- Status values for tasks are: todo, in_progress, or done
- Role values for users are: admin or member`;

      const embedding = await this.embeddingsService.generateEmbedding(text);

      const payload = {
        entity_type: 'system_info',
        entity_id: 'requirements',
        text: text,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: systemInfo,
      };

      const pointId = this.generatePointId('system_info', 'requirements');
      await this.qdrantService.insertVector(
        this.collectionName,
        pointId,
        embedding,
        payload,
      );

      this.logger.log('✓ System information indexed');
    } catch (error) {
      this.logger.error(`Failed to index system info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Index app statistics
   */
  async indexStatistics(): Promise<void> {
    try {
      this.logger.log('📊 Indexing app statistics...');

      // Get counts
      const userCount = await this.userRepository.count();
      const teamCount = await this.teamRepository.count();
      const projectCount = await this.projectRepository.count();
      const taskCount = await this.taskRepository.count();

      // Get status breakdown for tasks
      const todoCount = await this.taskRepository.count({
        where: { status: 'todo' as any },
      });
      const inProgressCount = await this.taskRepository.count({
        where: { status: 'in_progress' as any },
      });
      const doneCount = await this.taskRepository.count({
        where: { status: 'done' as any },
      });

      const statistics = {
        total_entities: userCount + teamCount + projectCount + taskCount,
        users: {
          total: userCount,
        },
        teams: {
          total: teamCount,
        },
        projects: {
          total: projectCount,
        },
        tasks: {
          total: taskCount,
          by_status: {
            todo: todoCount,
            in_progress: inProgressCount,
            done: doneCount,
          },
        },
        last_updated: new Date().toISOString(),
      };

      const text = `Application Statistics and Overview:

TOTAL ENTITIES: ${statistics.total_entities}

USERS: ${userCount} total users in the system

TEAMS: ${teamCount} total teams in the system

PROJECTS: ${projectCount} total projects in the system

TASKS: ${taskCount} total tasks
- To Do: ${todoCount} tasks
- In Progress: ${inProgressCount} tasks
- Done: ${doneCount} tasks

Last updated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;

      const embedding = await this.embeddingsService.generateEmbedding(text);

      const payload = {
        entity_type: 'statistics',
        entity_id: 'app_stats',
        text: text,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: statistics,
      };

      const pointId = this.generatePointId('statistics', 'app_stats');
      await this.qdrantService.insertVector(
        this.collectionName,
        pointId,
        embedding,
        payload,
      );

      this.logger.log(
        `✓ Statistics indexed (${statistics.total_entities} total entities)`,
      );
    } catch (error) {
      this.logger.error(`Failed to index statistics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Index everything including system info and statistics
   */
  async indexAll(): Promise<IndexingStats> {
    this.logger.log(
      '🚀 Starting FULL indexing (entities + system info + stats)...',
    );

    // Index system info and statistics first
    await this.indexSystemInfo();
    await this.indexStatistics();

    // Then index all entities
    return await this.indexAllEntities();
  }

  /**
   * Generate consistent point ID for Qdrant
   */
  private generatePointId(entityType: string, entityId: string): string {
    return `${entityType}-${entityId}`;
  }
}
