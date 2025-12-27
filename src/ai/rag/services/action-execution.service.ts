import { Injectable, Logger } from '@nestjs/common';
import { encode as toTOON } from '@toon-format/toon';
import { UsersService } from '../../../users/users.service';
import { TeamsService } from '../../../teams/teams.service';
import { ProjectsService } from '../../../projects/projects.service';
import { TasksService } from '../../../tasks/tasks.service';
import { IndexingService } from '../../indexing/indexing.service';
import { TaskStatus } from '../../../tasks/task.entity';
import { Source } from '../../dto/chat.dto';
import { GenerationService } from './generation.service';
import { SearchService, RetrievedDoc } from './search.service';
import {
  ConversationService,
  ConversationHistory,
} from './conversation.service';
import { LLMCacheService } from './llm-cache.service';
import { EntityResolutionService } from './entity-resolution.service';
import { FormattingService } from './formatting.service';
import { buildExtractFunctionParamsPrompt } from '../../prompts';

export interface FunctionCall {
  name: string;
  arguments: any;
  result?: any;
}

// Available functions/tools for AI
// NOTE: All ID parameters accept EITHER name OR UUID - system auto-resolves
export const AVAILABLE_FUNCTIONS = [
  // ===== TASK OPERATIONS =====
  {
    name: 'create_task',
    description: 'Create a new task',
    parameters: {
      title: 'string - Task title (required)',
      description: 'string - Task description (optional)',
      assignedTo: 'string - User name OR UUID (required)',
      status: 'string - Status: todo, in_progress, done (default: todo)',
      deadline: 'string - Deadline date in ISO format (optional)',
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task',
    parameters: {
      taskId: 'string - Task title OR UUID (required)',
      title: 'string - New title (optional)',
      description: 'string - New description (optional)',
      status: 'string - New status: todo, in_progress, done (optional)',
      assignedTo: 'string - User name OR UUID (optional)',
      deadline: 'string - New deadline in ISO format (optional)',
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task',
    parameters: {
      taskId: 'string - Task title OR UUID (required)',
    },
  },

  // ===== USER OPERATIONS =====
  {
    name: 'create_user',
    description: 'Create a new user',
    parameters: {
      name: 'string - User name (required)',
      email: 'string - User email (required)',
      password: 'string - User password (required)',
      role: 'string - User role: admin or member (optional, default: member)',
      teamId: 'string - Team name OR UUID (optional)',
    },
  },
  {
    name: 'update_user',
    description: 'Update user information',
    parameters: {
      userId: 'string - User name OR UUID (required)',
      name: 'string - New name (optional)',
      email: 'string - New email (optional)',
      password: 'string - New password (optional)',
      role: 'string - New role: admin or member (optional)',
      teamId: 'string - Team name OR UUID (optional)',
    },
  },
  {
    name: 'delete_user',
    description: 'Delete a user',
    parameters: {
      userId: 'string - User name OR UUID (required)',
    },
  },

  // ===== TEAM OPERATIONS =====
  {
    name: 'create_team',
    description: 'Create a new team',
    parameters: {
      name: 'string - Team name (required)',
      projectId: 'string - Project name OR UUID (required)',
      ownerId: 'string - Owner name OR UUID (required)',
    },
  },
  {
    name: 'update_team',
    description: 'Update team information',
    parameters: {
      teamId: 'string - Team name OR UUID (required)',
      name: 'string - New team name (optional)',
      projectId: 'string - Project name OR UUID (optional)',
      ownerId: 'string - Owner name OR UUID (optional)',
    },
  },
  {
    name: 'delete_team',
    description: 'Delete a team',
    parameters: {
      teamId: 'string - Team name OR UUID (required)',
    },
  },

  // ===== PROJECT OPERATIONS =====
  {
    name: 'create_project',
    description: 'Create a new project',
    parameters: {
      name: 'string - Project name (required)',
      description: 'string - Project description (optional)',
    },
  },
  {
    name: 'update_project',
    description: 'Update project information',
    parameters: {
      projectId: 'string - Project name OR UUID (required)',
      name: 'string - New project name (optional)',
      description: 'string - New description (optional)',
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project',
    parameters: {
      projectId: 'string - Project name OR UUID (required)',
    },
  },
];

@Injectable()
export class ActionExecutionService {
  private readonly logger = new Logger(ActionExecutionService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
    private readonly generationService: GenerationService,
    private readonly conversationService: ConversationService,
    private readonly searchService: SearchService,
    private readonly llmCacheService: LLMCacheService,
    private readonly entityResolutionService: EntityResolutionService,
    private readonly formattingService: FormattingService,
    private readonly indexingService: IndexingService, // ROOT FIX: Update index after CRUD
  ) {}

  async executeAction(
    query: string,
    classification: { type: string; intent: string },
    sessionId: string,
    retrievedDocs?: RetrievedDoc[], // Optional: pre-retrieved docs from RAG service
    filters?: { entity_types?: string[] }, // Pass filters for context retrieval
  ): Promise<{
    answer: string;
    sources?: Source[];
    functionCalls: FunctionCall[];
  }> {
    try {
      // Get conversation history for context
      const history = await this.conversationService.getHistory(sessionId);

      // ===== RETRIEVAL BEFORE ACTION =====
      // Use pre-retrieved docs if provided (more efficient), otherwise retrieve now
      let contextDocs: RetrievedDoc[];
      if (retrievedDocs && retrievedDocs.length > 0) {
        this.logger.log(
          `📄 Using ${retrievedDocs.length} pre-retrieved documents`,
        );
        contextDocs = retrievedDocs;
      } else {
        this.logger.log(`🔍 Retrieving context for action: "${query}"`);
        contextDocs = await this.retrieveActionContext(
          query,
          classification.intent,
          filters, // Pass extracted filters with entity_types
        );
        this.logger.log(
          `📄 Retrieved ${contextDocs.length} relevant documents`,
        );
      }

      // Use LLM to extract function call details WITH retrieved context
      const functionCall = await this.determineFunctionCall(
        query,
        classification,
        history,
        contextDocs,
      );

      if (!functionCall) {
        return {
          answer:
            "I understand you want to perform an action, but I couldn't determine the specific details. Please provide more information.",
          functionCalls: [],
        };
      }

      this.logger.log(`🔧 Executing function: ${functionCall.name}`);
      this.logger.log(
        `📝 Arguments: ${JSON.stringify(functionCall.arguments)}`,
      );

      let result: any;
      let answer: string;

      // Execute the appropriate function and format response using centralized formatting
      try {
        // Parse action and entity type from function name
        const [action, entityType] = functionCall.name.split('_');

        switch (functionCall.name) {
          // TASK OPERATIONS
          case 'create_task':
            result = await this.executeCreateTask(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'create',
              'task',
              result,
            );
            break;

          case 'update_task':
            result = await this.executeUpdateTask(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'update',
              'task',
              result,
            );
            break;

          case 'delete_task':
            result = await this.executeDeleteTask(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'delete',
              'task',
              { taskId: functionCall.arguments.taskId },
            );
            break;

          // USER OPERATIONS
          case 'create_user':
            result = await this.executeCreateUser(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'create',
              'user',
              result,
            );
            break;

          case 'update_user':
            result = await this.executeUpdateUser(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'update',
              'user',
              result,
            );
            break;

          case 'delete_user':
            result = await this.executeDeleteUser(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'delete',
              'user',
              { userId: functionCall.arguments.userId },
            );
            break;

          // TEAM OPERATIONS
          case 'create_team':
            result = await this.executeCreateTeam(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'create',
              'team',
              result,
            );
            break;

          case 'update_team':
            result = await this.executeUpdateTeam(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'update',
              'team',
              result,
            );
            break;

          case 'delete_team':
            result = await this.executeDeleteTeam(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'delete',
              'team',
              { teamId: functionCall.arguments.teamId },
            );
            break;

          // PROJECT OPERATIONS
          case 'create_project':
            result = await this.executeCreateProject(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'create',
              'project',
              result,
            );
            break;

          case 'update_project':
            result = await this.executeUpdateProject(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'update',
              'project',
              result,
            );
            break;

          case 'delete_project':
            result = await this.executeDeleteProject(functionCall.arguments);
            answer = this.formattingService.formatActionResult(
              'delete',
              'project',
              { projectId: functionCall.arguments.projectId },
            );
            break;

          default:
            answer = `❌ Unknown function: ${functionCall.name}`;
        }

        functionCall.result = result;

        return {
          answer,
          functionCalls: [functionCall],
        };
      } catch (execError) {
        // CRITICAL FIX: Include attempted parameters in error response for follow-up queries
        this.logger.error(`❌ Action execution failed: ${execError.message}`);

        // Format error using LLM
        const friendlyError = await this.generationService.formatErrorMessage(
          execError.message,
          query,
        );

        // Include extracted params in the response so history preserves them
        const extractedParams = Object.entries(functionCall.arguments)
          .map(([k, v]) => `${k}="${v}"`)
          .join(', ');
        const errorWithContext = `${friendlyError}\n\n[Extracted so far: ${extractedParams}]`;

        return {
          answer: errorWithContext,
          functionCalls: [functionCall], // Include the partial function call
        };
      }
    } catch (error) {
      this.logger.error(`❌ Action execution failed: ${error.message}`);

      // Format error using LLM
      const friendlyError = await this.generationService.formatErrorMessage(
        error.message,
        query,
      );

      return {
        answer: friendlyError,
        functionCalls: [],
      };
    }
  }

  /**
   * Retrieve relevant documents for action context
   * ROOT FIX: FORCED multi-entity retrieval with intelligent limiting
   * - CREATE/UPDATE actions ALWAYS retrieve users (for assignments)
   * - Limit to top 5 per entity type (not 115 total)
   * - Use semantic entity detection from classification
   */
  private async retrieveActionContext(
    query: string,
    intent: string,
    classificationFilters?: { entity_types?: string[] },
  ): Promise<RetrievedDoc[]> {
    try {
      // ROOT FIX #1: Use LLM-extracted entity types from classification
      let entityTypes: string[] = classificationFilters?.entity_types || [];

      // ROOT FIX #2: FORCE user retrieval for CREATE/UPDATE (assignment context)
      const actionType = intent.split('_')[0]; // create, update, delete
      const baseEntityType =
        this.formattingService.getEntityTypeFromIntent(intent);

      if (
        (actionType === 'create' || actionType === 'update') &&
        baseEntityType
      ) {
        // Always need BOTH base entity and users for assignments
        if (!entityTypes.includes(baseEntityType)) {
          entityTypes.push(baseEntityType);
        }
        if (!entityTypes.includes('user')) {
          entityTypes.push('user'); // For "assign to X"
        }
        this.logger.log(
          `🎯 Forced multi-entity: ${entityTypes.join(', ')} (create/update)`,
        );
      }

      // Fallback if still empty
      if (entityTypes.length === 0 && baseEntityType) {
        entityTypes = [baseEntityType];
      }

      // ROOT FIX #3: PARALLEL retrieval with SMART LIMITING (top 5 per type)
      if (entityTypes.length > 1) {
        this.logger.log(`🔍 Multi-entity retrieval: ${entityTypes.join(', ')}`);

        const searchPromises = entityTypes.map(async (type) => {
          const docs = await this.searchService.vectorSearch(query, {
            entity_type: type,
          });
          // LIMIT: Top 5 per type instead of 115 total
          return docs.slice(0, 5);
        });

        const results = await Promise.all(searchPromises);
        return results.flat(); // Merge all results
      } else {
        // Single entity type (original behavior)
        const filters: any = {};
        if (entityTypes.length === 1) {
          filters.entity_type = entityTypes[0];
        }
        const docs = await this.searchService.vectorSearch(query, filters);
        return docs.slice(0, 5);
      }
    } catch (error) {
      this.logger.warn(`Retrieval failed: ${error.message}`);
      return [];
    }
  }

  private async determineFunctionCall(
    query: string,
    classification: { type: string; intent: string },
    history: ConversationHistory[],
    retrievedDocs: RetrievedDoc[],
  ): Promise<FunctionCall | null> {
    this.logger.debug(`\n${'='.repeat(60)}`);
    this.logger.debug(`🔧 DETERMINE FUNCTION CALL`);
    this.logger.debug(`${'='.repeat(60)}`);
    this.logger.debug(`📥 INPUT - Query: "${query}"`);
    this.logger.debug(
      `📥 INPUT - Classification: ${JSON.stringify(classification)}`,
    );
    this.logger.debug(`📥 INPUT - History entries: ${history.length}`);
    this.logger.debug(`📥 INPUT - Retrieved docs: ${retrievedDocs.length}`);

    // Log retrieved documents in detail
    if (retrievedDocs.length > 0) {
      this.logger.debug(`\n📄 RETRIEVED DOCUMENTS:`);
      retrievedDocs.slice(0, 5).forEach((doc, i) => {
        this.logger.debug(
          `  [${i + 1}] Type: ${doc.entityType} | ID: ${doc.entityId}`,
        );
        this.logger.debug(`      Score: ${doc.score.toFixed(3)}`);
        this.logger.debug(`      Text: "${doc.text.substring(0, 100)}..."`);
      });
      if (retrievedDocs.length > 5) {
        this.logger.debug(
          `  ... and ${retrievedDocs.length - 5} more documents`,
        );
      }
    }

    // Use centralized formatting for retrieval context and history
    const retrievalContext =
      this.formattingService.buildRetrievalContext(retrievedDocs);
    const historyContext =
      this.formattingService.formatHistoryDetailed(history, 10) || 'none';

    // Determine which function parameters are needed based on classification
    const funcName = this.formattingService.formatFunctionName(classification);
    const funcDef = AVAILABLE_FUNCTIONS.find((f) => f.name === funcName);

    // DEBUG: Log function resolution
    this.logger.debug(
      `🔍 Classification: type="${classification.type}" intent="${classification.intent}"`,
    );
    this.logger.debug(`🔧 Resolved function: "${funcName}"`);

    if (!funcDef) {
      this.logger.error(`❌ No function definition found for: ${funcName}`);
      this.logger.error(
        `Available functions: ${AVAILABLE_FUNCTIONS.map((f) => f.name).join(', ')}`,
      );
      return null;
    }

    const paramList = Object.entries(funcDef.parameters)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    // Get primary ID param name for the example
    const primaryIdParam =
      Object.keys(funcDef.parameters).find(
        (k) => k.endsWith('Id') || k === 'title' || k === 'name',
      ) || 'id';

    this.logger.debug(
      `📋 Expected parameters: ${Object.keys(funcDef.parameters).join(', ')}`,
    );
    this.logger.debug(`🔑 Primary param: ${primaryIdParam}`);

    // Use centralized prompt
    const prompt = buildExtractFunctionParamsPrompt(
      funcName,
      paramList,
      retrievalContext,
      historyContext,
      query,
      primaryIdParam || 'id',
    );

    this.logger.debug(`\n📤 LLM PROMPT (${prompt.length} chars):`);
    this.logger.debug(`${'-'.repeat(60)}`);
    this.logger.debug(
      prompt.substring(0, 500) +
        (prompt.length > 500 ? '\n... (truncated)' : ''),
    );
    this.logger.debug(`${'-'.repeat(60)}`);

    try {
      const response = await this.llmCacheService.cachedCallWithModel(
        prompt,
        this.llmCacheService.getFastModel(),
        { temperature: 0.1 },
      );

      this.logger.debug(`\n📨 LLM RESPONSE:`);
      this.logger.debug(`${'-'.repeat(60)}`);
      this.logger.debug(response);
      this.logger.debug(`${'-'.repeat(60)}`);

      // Use centralized JSON extraction
      const parsed = this.formattingService.extractJsonFromResponse(response);
      if (!parsed) {
        this.logger.warn('❌ No JSON in LLM response');
        return null;
      }

      this.logger.debug(`\n📦 PARSED FUNCTION CALL:`);
      this.logger.debug(`  Function: ${parsed.name}`);
      this.logger.debug(
        `  Arguments: ${JSON.stringify(parsed.arguments, null, 2)}`,
      );
      this.logger.debug(`${'='.repeat(60)}\n`);

      return parsed;
    } catch (error) {
      this.logger.error(`❌ Function call failed: ${error.message}`);
      return null;
    }
  }

  // ===== CRUD EXECUTION METHODS =====

  // ----- TASK OPERATIONS -----
  private async executeCreateTask(args: any): Promise<any> {
    try {
      // Validate required fields
      if (!args.title) {
        throw new Error('Please provide a title for the task.');
      }

      // ===== SMART USER RESOLUTION - Using centralized service =====
      let resolvedUserId: string | undefined = undefined;
      if (args.assignedTo) {
        const userId = await this.entityResolutionService.resolveUserId(
          args.assignedTo,
        );
        if (!userId) {
          throw new Error(
            `User "${args.assignedTo}" not found. Please make sure the user exists in the system.`,
          );
        }
        resolvedUserId = userId;
      }

      // Map status to valid enum values
      let status = TaskStatus.TODO; // Default
      if (args.status) {
        const statusLower = args.status.toLowerCase().replace(/\s+/g, '_');
        if (statusLower === 'todo' || statusLower === 'to_do') {
          status = TaskStatus.TODO;
        } else if (
          statusLower === 'in_progress' ||
          statusLower === 'inprogress'
        ) {
          status = TaskStatus.IN_PROGRESS;
        } else if (statusLower === 'done' || statusLower === 'completed') {
          status = TaskStatus.DONE;
        }
      }

      const taskData = {
        title: args.title,
        description: args.description || '',
        status: status,
        ...(resolvedUserId && { assignedTo: resolvedUserId }), // ✅ Only include if provided
        deadline: args.deadline ? new Date(args.deadline) : undefined,
      };

      const task = await this.tasksService.create(taskData as any);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.indexTask(task.id);
        this.logger.debug(`📊 Indexed new task: ${task.id}`);
      } catch (indexError) {
        this.logger.warn(`Failed to index task: ${indexError.message}`);
      }

      return task;
    } catch (error) {
      throw new Error(`Failed to create task: ${error.message}`);
    }
  }

  private async executeUpdateTask(args: any): Promise<any> {
    try {
      if (!args.taskId) {
        throw new Error('Please provide the task title or ID to update.');
      }

      // Resolve task title/ID to actual ID
      const resolvedTaskId = await this.entityResolutionService.resolveTaskId(
        args.taskId,
      );
      if (!resolvedTaskId) {
        throw new Error(
          `Task "${args.taskId}" not found. Please make sure the task exists.`,
        );
      }

      const updateData: any = {};
      if (args.title) updateData.title = args.title;
      if (args.description) updateData.description = args.description;

      // ===== SMART USER RESOLUTION FOR REASSIGNMENT =====
      if (args.assignedTo) {
        const resolvedUserId = await this.entityResolutionService.resolveUserId(
          args.assignedTo,
        );
        if (!resolvedUserId) {
          throw new Error(
            `User "${args.assignedTo}" not found. Please make sure the user exists in the system.`,
          );
        }
        updateData.assignedTo = resolvedUserId;
      }

      if (args.deadline) updateData.deadline = new Date(args.deadline);

      // Map status string to TaskStatus enum
      if (args.status) {
        const statusLower = args.status.toLowerCase().replace(/\s+/g, '_');
        if (statusLower === 'todo' || statusLower === 'to_do') {
          updateData.status = TaskStatus.TODO;
        } else if (
          statusLower === 'in_progress' ||
          statusLower === 'inprogress'
        ) {
          updateData.status = TaskStatus.IN_PROGRESS;
        } else if (statusLower === 'done' || statusLower === 'completed') {
          updateData.status = TaskStatus.DONE;
        }
      }

      const task = await this.tasksService.update(resolvedTaskId, updateData);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.reindexEntity('task', resolvedTaskId);
        this.logger.debug(`📊 Reindexed task: ${resolvedTaskId}`);
      } catch (indexError) {
        this.logger.warn(`Failed to reindex task: ${indexError.message}`);
      }

      return task;
    } catch (error) {
      throw new Error(`Failed to update task: ${error.message}`);
    }
  }

  private async executeDeleteTask(args: any): Promise<any> {
    try {
      if (!args.taskId) {
        throw new Error('Please provide the task title or ID to delete.');
      }

      // Resolve task title/ID to actual ID
      const resolvedTaskId = await this.entityResolutionService.resolveTaskId(
        args.taskId,
      );
      if (!resolvedTaskId) {
        throw new Error(
          `Task "${args.taskId}" not found. Please make sure the task exists.`,
        );
      }

      await this.tasksService.remove(resolvedTaskId);

      // ROOT FIX: Remove from vector index
      try {
        await this.indexingService.deleteFromIndex('task', resolvedTaskId);
        this.logger.debug(`📊 Removed task from index: ${resolvedTaskId}`);
      } catch (indexError) {
        this.logger.warn(
          `Failed to remove task from index: ${indexError.message}`,
        );
      }

      return { deleted: true, taskId: resolvedTaskId };
    } catch (error) {
      throw new Error(`Failed to delete task: ${error.message}`);
    }
  }

  // ----- USER OPERATIONS -----
  private async executeCreateUser(args: any): Promise<any> {
    try {
      // Validate required fields
      if (!args.name) {
        throw new Error('Please provide a name for the user.');
      }
      if (!args.email) {
        throw new Error('Please provide an email address for the user.');
      }
      if (!args.password) {
        throw new Error(
          'Please provide a password for the user. Passwords must be at least 6 characters.',
        );
      }

      // Resolve team by name if provided
      let resolvedTeamId: string | undefined = undefined;
      if (args.teamId) {
        const teamId = await this.entityResolutionService.resolveTeamId(
          args.teamId,
        );
        if (!teamId) {
          throw new Error(
            `Team "${args.teamId}" not found. Please make sure the team exists.`,
          );
        }
        resolvedTeamId = teamId;
      }

      const userData = {
        name: args.name,
        email: args.email,
        password: args.password,
        role: args.role,
        teamId: resolvedTeamId,
      };

      const user = await this.usersService.create(userData);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.indexUser(user.id);
        this.logger.debug(`📊 Indexed new user: ${user.id}`);
      } catch (indexError) {
        this.logger.warn(`Failed to index user: ${indexError.message}`);
      }

      return user;
    } catch (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  private async executeUpdateUser(args: any): Promise<any> {
    try {
      if (!args.userId) {
        throw new Error('Please provide the user name or ID to update.');
      }

      // Resolve user name/ID to actual ID
      const resolvedUserId = await this.entityResolutionService.resolveUserId(
        args.userId,
      );
      if (!resolvedUserId) {
        throw new Error(
          `User "${args.userId}" not found. Please make sure the user exists.`,
        );
      }

      const updateData: any = {};
      if (args.name) updateData.name = args.name;
      if (args.email) updateData.email = args.email;
      if (args.password) updateData.password = args.password;
      if (args.role) updateData.role = args.role;

      // Resolve team by name if provided
      if (args.teamId) {
        const resolvedTeamId = await this.entityResolutionService.resolveTeamId(
          args.teamId,
        );
        if (!resolvedTeamId) {
          throw new Error(
            `Team "${args.teamId}" not found. Please make sure the team exists.`,
          );
        }
        updateData.teamId = resolvedTeamId;
      }

      const user = await this.usersService.update(resolvedUserId, updateData);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.reindexEntity('user', resolvedUserId);
        this.logger.debug(`📊 Reindexed user: ${resolvedUserId}`);
      } catch (indexError) {
        this.logger.warn(`Failed to reindex user: ${indexError.message}`);
      }

      return user;
    } catch (error) {
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  private async executeDeleteUser(args: any): Promise<any> {
    try {
      if (!args.userId) {
        throw new Error('Please provide the user name or ID to delete.');
      }

      // Resolve user name/ID to actual ID
      const resolvedUserId = await this.entityResolutionService.resolveUserId(
        args.userId,
      );
      if (!resolvedUserId) {
        throw new Error(
          `User "${args.userId}" not found. Please make sure the user exists.`,
        );
      }

      await this.usersService.remove(resolvedUserId);

      // ROOT FIX: Remove from vector index
      try {
        await this.indexingService.deleteFromIndex('user', resolvedUserId);
        this.logger.debug(`📊 Removed user from index: ${resolvedUserId}`);
      } catch (indexError) {
        this.logger.warn(
          `Failed to remove user from index: ${indexError.message}`,
        );
      }

      return { deleted: true, userId: resolvedUserId };
    } catch (error) {
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  // ----- TEAM OPERATIONS -----
  private async executeCreateTeam(args: any): Promise<any> {
    try {
      if (!args.name) {
        throw new Error('Please provide a name for the team.');
      }
      if (!args.projectId) {
        throw new Error('Please specify which project this team belongs to.');
      }
      if (!args.ownerId) {
        throw new Error('Please specify who should be the team owner.');
      }

      // Resolve project by name if not UUID
      const resolvedProjectId =
        await this.entityResolutionService.resolveProjectId(args.projectId);
      if (!resolvedProjectId) {
        throw new Error(
          `Project "${args.projectId}" not found. Please make sure the project exists.`,
        );
      }

      // Resolve owner by name if not UUID
      const resolvedOwnerId = await this.entityResolutionService.resolveUserId(
        args.ownerId,
      );
      if (!resolvedOwnerId) {
        throw new Error(
          `User "${args.ownerId}" not found. Please make sure the user exists.`,
        );
      }

      const teamData = {
        name: args.name,
        projectId: resolvedProjectId,
        ownerId: resolvedOwnerId,
      };

      const team = await this.teamsService.create(teamData);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.indexTeam(team.id);
        this.logger.debug(`📊 Indexed new team: ${team.id}`);
      } catch (indexError) {
        this.logger.warn(`Failed to index team: ${indexError.message}`);
      }

      return team;
    } catch (error) {
      throw new Error(`Failed to create team: ${error.message}`);
    }
  }

  private async executeUpdateTeam(args: any): Promise<any> {
    try {
      if (!args.teamId) {
        throw new Error('Please provide the team name or ID to update.');
      }

      // Resolve team name/ID to actual ID
      const resolvedTeamId = await this.entityResolutionService.resolveTeamId(
        args.teamId,
      );
      if (!resolvedTeamId) {
        throw new Error(
          `Team "${args.teamId}" not found. Please make sure the team exists.`,
        );
      }

      const updateData: any = {};
      if (args.name) updateData.name = args.name;

      // Resolve project by name if provided
      if (args.projectId) {
        const resolvedProjectId =
          await this.entityResolutionService.resolveProjectId(args.projectId);
        if (!resolvedProjectId) {
          throw new Error(
            `Project "${args.projectId}" not found. Please make sure the project exists.`,
          );
        }
        updateData.projectId = resolvedProjectId;
      }

      // Resolve owner by name if provided
      if (args.ownerId) {
        const resolvedOwnerId =
          await this.entityResolutionService.resolveUserId(args.ownerId);
        if (!resolvedOwnerId) {
          throw new Error(
            `User "${args.ownerId}" not found. Please make sure the user exists.`,
          );
        }
        updateData.ownerId = resolvedOwnerId;
      }

      const team = await this.teamsService.update(resolvedTeamId, updateData);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.reindexEntity('team', resolvedTeamId);
        this.logger.debug(`📊 Reindexed team: ${resolvedTeamId}`);
      } catch (indexError) {
        this.logger.warn(`Failed to reindex team: ${indexError.message}`);
      }

      return team;
    } catch (error) {
      throw new Error(`Failed to update team: ${error.message}`);
    }
  }

  private async executeDeleteTeam(args: any): Promise<any> {
    try {
      if (!args.teamId) {
        throw new Error('Please provide the team name or ID to delete.');
      }

      // Resolve team name/ID to actual ID
      const resolvedTeamId = await this.entityResolutionService.resolveTeamId(
        args.teamId,
      );
      if (!resolvedTeamId) {
        throw new Error(
          `Team "${args.teamId}" not found. Please make sure the team exists in the system.`,
        );
      }

      await this.teamsService.remove(resolvedTeamId);

      // ROOT FIX: Remove from vector index
      try {
        await this.indexingService.deleteFromIndex('team', resolvedTeamId);
        this.logger.debug(`📊 Removed team from index: ${resolvedTeamId}`);
      } catch (indexError) {
        this.logger.warn(
          `Failed to remove team from index: ${indexError.message}`,
        );
      }

      return { deleted: true, teamId: resolvedTeamId };
    } catch (error) {
      throw new Error(`Failed to delete team: ${error.message}`);
    }
  }

  // ----- PROJECT OPERATIONS -----
  private async executeCreateProject(args: any): Promise<any> {
    try {
      if (!args.name) {
        throw new Error('Please provide a name for the project.');
      }
      const projectData = {
        name: args.name,
        description: args.description || '',
      };

      const project = await this.projectsService.create(projectData);

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.indexProject(project.id);
        this.logger.debug(`📊 Indexed new project: ${project.id}`);
      } catch (indexError) {
        this.logger.warn(`Failed to index project: ${indexError.message}`);
      }

      return project;
    } catch (error) {
      throw new Error(`Failed to create project: ${error.message}`);
    }
  }

  private async executeUpdateProject(args: any): Promise<any> {
    try {
      if (!args.projectId) {
        throw new Error('Please provide the project name or ID to update.');
      }

      // Resolve project name/ID to actual ID
      const resolvedProjectId =
        await this.entityResolutionService.resolveProjectId(args.projectId);
      if (!resolvedProjectId) {
        throw new Error(
          `Project "${args.projectId}" not found. Please make sure the project exists.`,
        );
      }

      const updateData: any = {};
      if (args.name) updateData.name = args.name;
      if (args.description) updateData.description = args.description;

      const project = await this.projectsService.update(
        resolvedProjectId,
        updateData,
      );

      // ROOT FIX: Update vector index immediately
      try {
        await this.indexingService.reindexEntity('project', resolvedProjectId);
        this.logger.debug(`📊 Reindexed project: ${resolvedProjectId}`);
      } catch (indexError) {
        this.logger.warn(`Failed to reindex project: ${indexError.message}`);
      }

      return project;
    } catch (error) {
      throw new Error(`Failed to update project: ${error.message}`);
    }
  }

  private async executeDeleteProject(args: any): Promise<any> {
    try {
      if (!args.projectId) {
        throw new Error('Please provide the project name or ID to delete.');
      }

      // Resolve project name/ID to actual ID
      const resolvedProjectId =
        await this.entityResolutionService.resolveProjectId(args.projectId);
      if (!resolvedProjectId) {
        throw new Error(
          `Project "${args.projectId}" not found. Please make sure the project exists.`,
        );
      }

      await this.projectsService.remove(resolvedProjectId);

      // ROOT FIX: Remove from vector index
      try {
        await this.indexingService.deleteFromIndex(
          'project',
          resolvedProjectId,
        );
        this.logger.debug(
          `📊 Removed project from index: ${resolvedProjectId}`,
        );
      } catch (indexError) {
        this.logger.warn(
          `Failed to remove project from index: ${indexError.message}`,
        );
      }

      return { deleted: true, projectId: resolvedProjectId };
    } catch (error) {
      throw new Error(`Failed to delete project: ${error.message}`);
    }
  }
}
