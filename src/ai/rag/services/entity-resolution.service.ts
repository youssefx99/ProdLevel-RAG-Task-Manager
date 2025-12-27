import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../../../users/users.service';
import { TeamsService } from '../../../teams/teams.service';
import { ProjectsService } from '../../../projects/projects.service';
import { TasksService } from '../../../tasks/tasks.service';
import { PaginatedResult } from '../../../common/dto/pagination.dto';

export type EntityType = 'user' | 'team' | 'project' | 'task';

export interface ResolvedEntity {
  id: string;
  entity: any;
  type: EntityType;
}

/**
 * Centralized entity resolution service.
 * Resolves entity names or IDs to actual database records.
 * Eliminates duplicate resolution logic across services.
 */
@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  // UUID pattern for validation
  private readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
  ) {}

  /**
   * Check if a string is a valid UUID
   */
  isUUID(value: string): boolean {
    return this.UUID_PATTERN.test(value?.trim() || '');
  }

  /**
   * Generic entity resolution method
   */
  private async resolveEntity<T extends { id: string }>(
    nameOrId: string,
    findOne: (id: string) => Promise<T>,
    findAll: () => Promise<PaginatedResult<T>>,
    nameExtractor: (entity: T) => string,
    entityType: EntityType,
  ): Promise<string | null> {
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🔍 ENTITY RESOLUTION: ${entityType.toUpperCase()}`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Name/ID: "${nameOrId}"`);

    if (!nameOrId) {
      this.logger.debug(`⚠️ Empty ${entityType} identifier`);
      this.logger.debug(`📤 OUTPUT - Result: null`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      return null;
    }

    const trimmed = nameOrId.trim();

    // Check if it's already a UUID
    if (this.isUUID(trimmed)) {
      this.logger.debug(`🆔 Detected UUID format`);
      try {
        const entity = await findOne(trimmed);
        this.logger.debug(`✅ UUID resolved successfully`);
        this.logger.debug(`   Entity name: "${nameExtractor(entity)}"`);
        this.logger.debug(`📤 OUTPUT - Result: ${trimmed}`);
        this.logger.debug(`${'='.repeat(60)}\n`);
        return trimmed;
      } catch {
        this.logger.debug(`❌ UUID not found in database`);
        this.logger.debug(`📤 OUTPUT - Result: null`);
        this.logger.debug(`${'='.repeat(60)}\n`);
        return null;
      }
    }

    // Search by name (case-insensitive)
    this.logger.debug(`🔍 Searching ${entityType} by name...`);
    try {
      const result = await findAll();
      const entities = result.data; // Extract data from paginated result
      this.logger.debug(
        `📋 Found ${entities.length} ${entityType}s in database`,
      );

      // Log first few entities for reference
      if (entities.length > 0) {
        this.logger.debug(`   Available names:`);
        entities.slice(0, 5).forEach((e) => {
          this.logger.debug(`     - "${nameExtractor(e)}"`);
        });
        if (entities.length > 5) {
          this.logger.debug(`     ... and ${entities.length - 5} more`);
        }
      }

      const entity = entities.find(
        (e) => nameExtractor(e).toLowerCase() === trimmed.toLowerCase(),
      );

      if (entity) {
        this.logger.debug(`✅ Exact match found: "${nameExtractor(entity)}"`);
        this.logger.debug(`📤 OUTPUT - Result: ${entity.id}`);
        this.logger.debug(`${'='.repeat(60)}\n`);
      } else {
        this.logger.debug(`❌ No exact match found for "${trimmed}"`);
        this.logger.debug(`📤 OUTPUT - Result: null`);
        this.logger.debug(`${'='.repeat(60)}\n`);
      }
      return entity ? entity.id : null;
    } catch (error) {
      this.logger.error(`❌ Failed to resolve ${entityType}: ${error.message}`);
      this.logger.debug(`📤 OUTPUT - Result: null (error)`);
      this.logger.debug(`${'='.repeat(60)}\n`);
      return null;
    }
  }

  /**
   * Resolve user by name or ID
   */
  async resolveUserId(nameOrId: string): Promise<string | null> {
    return this.resolveEntity(
      nameOrId,
      (id) => this.usersService.findOne(id),
      () => this.usersService.findAll(1, 1000), // Get all for name matching
      (user) => user.name,
      'user',
    );
  }

  /**
   * Resolve team by name or ID
   */
  async resolveTeamId(nameOrId: string): Promise<string | null> {
    return this.resolveEntity(
      nameOrId,
      (id) => this.teamsService.findOne(id),
      () => this.teamsService.findAll(1, 1000), // Get all for name matching
      (team) => team.name,
      'team',
    );
  }

  /**
   * Resolve project by name or ID
   */
  async resolveProjectId(nameOrId: string): Promise<string | null> {
    return this.resolveEntity(
      nameOrId,
      (id) => this.projectsService.findOne(id),
      () => this.projectsService.findAll(1, 1000), // Get all for name matching
      (project) => project.name,
      'project',
    );
  }

  /**
   * Resolve task by title or ID
   */
  async resolveTaskId(titleOrId: string): Promise<string | null> {
    return this.resolveEntity(
      titleOrId,
      (id) => this.tasksService.findOne(id),
      () => this.tasksService.findAll(1, 1000), // Get all for name matching
      (task) => task.title,
      'task',
    );
  }

  /**
   * ROOT FIX: Fuzzy user resolution with partial matching
   * Finds users even with partial name matches (e.g., "youssef" matches "Youssef Mohamed")
   */
  async resolveUserIdFuzzy(nameOrId: string): Promise<string | null> {
    this.logger.debug(`🎯 Fuzzy resolving user: "${nameOrId}"`);
    if (!nameOrId) return null;
    const trimmed = nameOrId.trim().toLowerCase();

    // Check if it's already a UUID
    if (this.isUUID(trimmed)) {
      this.logger.debug(`🆔 UUID detected in fuzzy search`);
      try {
        await this.usersService.findOne(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    this.logger.debug(`🔍 Attempting fuzzy match with 4-tier matching...`);
    try {
      const result = await this.usersService.findAll(1, 1000); // Get all users for fuzzy matching
      const users = result.data; // Extract data from paginated result

      // 1. Try exact match first
      const exactMatch = users.find((u) => u.name.toLowerCase() === trimmed);
      if (exactMatch) return exactMatch.id;

      // 2. Try starts-with match
      const startsWithMatch = users.find((u) =>
        u.name.toLowerCase().startsWith(trimmed),
      );
      if (startsWithMatch) return startsWithMatch.id;

      // 3. Try contains match (fuzzy)
      const containsMatch = users.find((u) =>
        u.name.toLowerCase().includes(trimmed),
      );
      if (containsMatch) return containsMatch.id;

      // 4. Try email prefix match
      const emailMatch = users.find((u) =>
        u.email.split('@')[0].toLowerCase().includes(trimmed),
      );
      if (emailMatch) return emailMatch.id;

      return null;
    } catch (error) {
      this.logger.error(`Fuzzy user resolution failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve entity by type - unified method
   */
  async resolveByType(
    nameOrId: string,
    entityType: EntityType,
  ): Promise<string | null> {
    switch (entityType) {
      case 'user':
        return this.resolveUserId(nameOrId);
      case 'team':
        return this.resolveTeamId(nameOrId);
      case 'project':
        return this.resolveProjectId(nameOrId);
      case 'task':
        return this.resolveTaskId(nameOrId);
      default:
        this.logger.warn(`Unknown entity type: ${entityType}`);
        return null;
    }
  }

  /**
   * Resolve multiple entities at once
   */
  async resolveMultiple(
    entities: Array<{ nameOrId: string; type: EntityType }>,
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    await Promise.all(
      entities.map(async ({ nameOrId, type }) => {
        const resolved = await this.resolveByType(nameOrId, type);
        results.set(`${type}:${nameOrId}`, resolved);
      }),
    );

    return results;
  }

  /**
   * Get entity type from intent
   */
  getEntityTypeFromIntent(intent: string): EntityType | null {
    const intentToEntity: Record<string, EntityType> = {
      task_management: 'task',
      user_info: 'user',
      team_info: 'team',
      project_info: 'project',
    };
    return intentToEntity[intent] || null;
  }
}
