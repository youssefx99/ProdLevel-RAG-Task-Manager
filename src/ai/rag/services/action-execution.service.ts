import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { encode as toTOON } from '@toon-format/toon';
import { OllamaService } from '../../llm/ollama.service';
import { UsersService } from '../../../users/users.service';
import { TeamsService } from '../../../teams/teams.service';
import { ProjectsService } from '../../../projects/projects.service';
import { TasksService } from '../../../tasks/tasks.service';
import { TaskStatus } from '../../../tasks/task.entity';
import { Source } from '../../dto/chat.dto';
import { GenerationService } from './generation.service';
import { SearchService, RetrievedDoc } from './search.service';
import {
  ConversationService,
  ConversationHistory,
} from './conversation.service';

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
    private readonly ollamaService: OllamaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
    private readonly generationService: GenerationService,
    private readonly conversationService: ConversationService,
    private readonly searchService: SearchService,
  ) {}

  // ===== CACHED LLM WRAPPER =====
  private async cachedLLMCall(
    prompt: string,
    model?: string,
    options?: { temperature?: number; system?: string },
  ): Promise<string> {
    const cacheKey = `llm:${crypto
      .createHash('md5')
      .update(prompt + (model || '') + JSON.stringify(options || {}))
      .digest('hex')}`;

    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(
        `⚡ LLM CACHE HIT for prompt: ${prompt.substring(0, 50)}...`,
      );
      return cached;
    }

    const result = await this.ollamaService.generateCompletion(
      prompt,
      model,
      options,
    );
    await this.cacheManager.set(cacheKey, result, 600000); // Cache for 10 minutes
    return result;
  }

  async executeAction(
    query: string,
    classification: { type: string; intent: string },
    sessionId: string,
  ): Promise<{
    answer: string;
    sources?: Source[];
    functionCalls: FunctionCall[];
  }> {
    try {
      // Get conversation history for context
      const history = await this.conversationService.getHistory(sessionId);

      // ===== NEW: RETRIEVAL BEFORE ACTION =====
      // Search for relevant entities to get IDs and context
      this.logger.log(`🔍 Retrieving context for action: "${query}"`);
      const retrievedDocs = await this.retrieveActionContext(
        query,
        classification.intent,
      );
      this.logger.log(
        `📄 Retrieved ${retrievedDocs.length} relevant documents`,
      );

      // Use LLM to extract function call details WITH retrieved context
      const functionCall = await this.determineFunctionCall(
        query,
        classification,
        history,
        retrievedDocs,
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

      // Execute the appropriate function
      try {
        switch (functionCall.name) {
          // TASK OPERATIONS
          case 'create_task':
            result = await this.executeCreateTask(functionCall.arguments);
            answer = `✅ Task created successfully!\n\n**Task Details:**\n- Title: ${result.title}\n- Description: ${result.description || 'N/A'}\n- Status: ${result.status}\n- Assigned to: ${result.assignedTo || 'Unassigned'}\n- Deadline: ${result.deadline ? new Date(result.deadline).toLocaleDateString() : 'N/A'}\n- Task ID: ${result.id}`;
            break;

          case 'update_task':
            result = await this.executeUpdateTask(functionCall.arguments);
            answer = `✅ Task updated successfully!\n\n**Updated Task:**\n- Title: ${result.title}\n- Status: ${result.status}\n- Description: ${result.description || 'N/A'}`;
            break;

          case 'delete_task':
            result = await this.executeDeleteTask(functionCall.arguments);
            answer = `✅ Task deleted successfully! (Task ID: ${functionCall.arguments.taskId})`;
            break;

          // USER OPERATIONS
          case 'create_user':
            result = await this.executeCreateUser(functionCall.arguments);
            answer = `✅ User created successfully!\n\n**User Details:**\n- Name: ${result.name}\n- Email: ${result.email}\n- Role: ${result.role}\n- Team ID: ${result.teamId || 'N/A'}\n- User ID: ${result.id}`;
            break;

          case 'update_user':
            result = await this.executeUpdateUser(functionCall.arguments);
            answer = `✅ User updated successfully!\n\n**Updated User:**\n- Name: ${result.name}\n- Email: ${result.email}\n- Role: ${result.role || 'N/A'}\n- Team ID: ${result.teamId || 'N/A'}`;
            break;

          case 'delete_user':
            result = await this.executeDeleteUser(functionCall.arguments);
            answer = `✅ User deleted successfully! (User ID: ${functionCall.arguments.userId})`;
            break;

          // TEAM OPERATIONS
          case 'create_team':
            result = await this.executeCreateTeam(functionCall.arguments);
            answer = `✅ Team created successfully!\n\n**Team Details:**\n- Name: ${result.name}\n- Project ID: ${result.projectId}\n- Owner ID: ${result.ownerId}\n- Team ID: ${result.id}`;
            break;

          case 'update_team':
            result = await this.executeUpdateTeam(functionCall.arguments);
            answer = `✅ Team updated successfully!\n\n**Updated Team:**\n- Name: ${result.name}\n- Project ID: ${result.projectId}\n- Owner ID: ${result.ownerId}`;
            break;

          case 'delete_team':
            result = await this.executeDeleteTeam(functionCall.arguments);
            answer = `✅ Team deleted successfully! (Team ID: ${functionCall.arguments.teamId})`;
            break;

          // PROJECT OPERATIONS
          case 'create_project':
            result = await this.executeCreateProject(functionCall.arguments);
            answer = `✅ Project created successfully!\n\n**Project Details:**\n- Name: ${result.name}\n- Description: ${result.description || 'N/A'}\n- Project ID: ${result.id}`;
            break;

          case 'update_project':
            result = await this.executeUpdateProject(functionCall.arguments);
            answer = `✅ Project updated successfully!\n\n**Updated Project:**\n- Name: ${result.name}\n- Description: ${result.description || 'N/A'}`;
            break;

          case 'delete_project':
            result = await this.executeDeleteProject(functionCall.arguments);
            answer = `✅ Project deleted successfully! (Project ID: ${functionCall.arguments.projectId})`;
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
   */
  private async retrieveActionContext(
    query: string,
    intent: string,
  ): Promise<RetrievedDoc[]> {
    try {
      // Determine entity type filter based on intent
      const entityTypeMap: Record<string, string> = {
        task_management: 'task',
        user_info: 'user',
        team_info: 'team',
        project_info: 'project',
      };

      const filters: any = {};
      if (entityTypeMap[intent]) {
        filters.entity_type = entityTypeMap[intent];
      }

      // Search for relevant entities
      const docs = await this.searchService.vectorSearch(query, filters);
      return docs.slice(0, 5); // Top 5 most relevant
    } catch (error) {
      this.logger.warn(`Retrieval failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Build context string from retrieved documents
   */
  private buildRetrievalContext(docs: RetrievedDoc[]): string {
    if (docs.length === 0) return 'No matching entities found in database.';

    return docs
      .map((doc, i) => {
        const id = doc.entityId || doc.metadata?.id || 'unknown';
        return `[${i + 1}] ${doc.entityType.toUpperCase()}: ${doc.text}\n    ID: ${id}`;
      })
      .join('\n');
  }

  private async determineFunctionCall(
    query: string,
    classification: { type: string; intent: string },
    history: ConversationHistory[],
    retrievedDocs: RetrievedDoc[],
  ): Promise<FunctionCall | null> {
    // Build context from retrieved documents
    const retrievalContext = this.buildRetrievalContext(retrievedDocs);

    // Build compact history context (last 4 messages) - CRITICAL for follow-up queries
    const recentHistory = history.slice(-4);
    const historyContext = recentHistory.length
      ? recentHistory
          .map(
            (h) => `[${h.role === 'user' ? 'USER' : 'ASSISTANT'}] ${h.content}`,
          )
          .join('\n')
      : 'none';

    // Determine which function parameters are needed based on classification
    const funcName = this.getFunctionName(classification);
    const funcDef = AVAILABLE_FUNCTIONS.find((f) => f.name === funcName);
    const paramList = funcDef
      ? Object.entries(funcDef.parameters)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n')
      : '';

    // Get primary ID param name for the example
    const primaryIdParam = funcDef
      ? Object.keys(funcDef.parameters).find(
          (k) => k.endsWith('Id') || k === 'title' || k === 'name',
        )
      : 'id';

    // CRITICAL FIX: Prompt must accumulate parameters from conversation history
    const prompt = `ROLE: Extract function parameters by COMBINING information from HISTORY and CURRENT REQUEST.

FUNCTION: ${funcName}
PARAMETERS:
${paramList}

DATABASE ENTITIES (use these IDs!):
${retrievalContext}

CONVERSATION HISTORY (extract missing parameters from here!):
${historyContext}

CURRENT REQUEST: "${query}"

CRITICAL INSTRUCTIONS:
1. ACCUMULATE parameters from BOTH the history AND the current request
2. If user previously mentioned a name like "mohamed tarek" and now provides email, COMBINE BOTH
3. If assistant asked for missing info and user now provides it, MERGE with previous values
4. Find matching entities in DATABASE ENTITIES and use their UUIDs
5. Use EXACT parameter names from PARAMETERS list

EXAMPLES:
- History: [USER] "create user john" [ASSISTANT] "need email" 
  Current: "his email is john@test.com"
  → {"name":"john","email":"john@test.com"}

- History: [USER] "create task 'Fix bug'" [ASSISTANT] "who to assign?"
  Current: "assign it to Bob"
  → {"title":"Fix bug","assignedTo":"<bob-uuid>"}

OUTPUT (JSON only, combine ALL extracted parameters):
{"name":"${funcName}","arguments":{"${primaryIdParam}":"<extracted-value>"}}`;

    try {
      const response = await this.cachedLLMCall(
        prompt,
        this.ollamaService.getFastLlmModel(),
        { temperature: 0.1 },
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn('No JSON in LLM response');
        return null;
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.logger.error(`Function call failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Map classification to function name
   */
  private getFunctionName(classification: {
    type: string;
    intent: string;
  }): string {
    const intentToEntity: Record<string, string> = {
      task_management: 'task',
      user_info: 'user',
      team_info: 'team',
      project_info: 'project',
    };
    const entity = intentToEntity[classification.intent] || 'task';
    return `${classification.type}_${entity}`;
  }

  // ===== CRUD EXECUTION METHODS =====

  // ===== ENTITY RESOLUTION HELPERS =====
  /**
   * Resolve user by name or ID. Returns user ID if found.
   * Searches case-insensitive by name if input is not a UUID.
   */
  private async resolveUserId(nameOrId: string): Promise<string | null> {
    if (!nameOrId) return null;

    const trimmed = nameOrId.trim();

    // Check if it's already a UUID (contains hyphens and hex chars)
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      // Already a UUID, verify it exists
      try {
        await this.usersService.findOne(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    // Search by name (case-insensitive)
    try {
      const users = await this.usersService.findAll();
      const user = users.find(
        (u) => u.name.toLowerCase() === trimmed.toLowerCase(),
      );
      return user ? user.id : null;
    } catch (error) {
      this.logger.error(`Failed to resolve user: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve team by name or ID. Returns team ID if found.
   */
  private async resolveTeamId(nameOrId: string): Promise<string | null> {
    if (!nameOrId) return null;

    const trimmed = nameOrId.trim();

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      try {
        await this.teamsService.findOne(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    try {
      const teams = await this.teamsService.findAll();
      const team = teams.find(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
      );
      return team ? team.id : null;
    } catch (error) {
      this.logger.error(`Failed to resolve team: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve project by name or ID. Returns project ID if found.
   */
  private async resolveProjectId(nameOrId: string): Promise<string | null> {
    if (!nameOrId) return null;

    const trimmed = nameOrId.trim();

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      try {
        await this.projectsService.findOne(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    try {
      const projects = await this.projectsService.findAll();
      const project = projects.find(
        (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
      );
      return project ? project.id : null;
    } catch (error) {
      this.logger.error(`Failed to resolve project: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve task by title or ID. Returns task ID if found.
   */
  private async resolveTaskId(titleOrId: string): Promise<string | null> {
    if (!titleOrId) return null;

    const trimmed = titleOrId.trim();

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      try {
        await this.tasksService.findOne(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    try {
      const tasks = await this.tasksService.findAll();
      const task = tasks.find(
        (t) => t.title.toLowerCase() === trimmed.toLowerCase(),
      );
      return task ? task.id : null;
    } catch (error) {
      this.logger.error(`Failed to resolve task: ${error.message}`);
      return null;
    }
  }

  // ----- TASK OPERATIONS -----
  private async executeCreateTask(args: any): Promise<any> {
    try {
      // Validate required fields
      if (!args.title) {
        throw new Error('Please provide a title for the task.');
      }

      // ===== SMART USER RESOLUTION =====
      // Resolve user name to ID (accepts both name and UUID) - assignedTo is now optional
      let resolvedUserId: string | undefined = undefined;
      if (args.assignedTo) {
        const userId = await this.resolveUserId(args.assignedTo);
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
      const resolvedTaskId = await this.resolveTaskId(args.taskId);
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
        const resolvedUserId = await this.resolveUserId(args.assignedTo);
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
      const resolvedTaskId = await this.resolveTaskId(args.taskId);
      if (!resolvedTaskId) {
        throw new Error(
          `Task "${args.taskId}" not found. Please make sure the task exists.`,
        );
      }

      await this.tasksService.remove(resolvedTaskId);
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
        const teamId = await this.resolveTeamId(args.teamId);
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
      const resolvedUserId = await this.resolveUserId(args.userId);
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
        const resolvedTeamId = await this.resolveTeamId(args.teamId);
        if (!resolvedTeamId) {
          throw new Error(
            `Team "${args.teamId}" not found. Please make sure the team exists.`,
          );
        }
        updateData.teamId = resolvedTeamId;
      }

      const user = await this.usersService.update(resolvedUserId, updateData);
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
      const resolvedUserId = await this.resolveUserId(args.userId);
      if (!resolvedUserId) {
        throw new Error(
          `User "${args.userId}" not found. Please make sure the user exists.`,
        );
      }

      await this.usersService.remove(resolvedUserId);
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
      const resolvedProjectId = await this.resolveProjectId(args.projectId);
      if (!resolvedProjectId) {
        throw new Error(
          `Project "${args.projectId}" not found. Please make sure the project exists.`,
        );
      }

      // Resolve owner by name if not UUID
      const resolvedOwnerId = await this.resolveUserId(args.ownerId);
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
      const resolvedTeamId = await this.resolveTeamId(args.teamId);
      if (!resolvedTeamId) {
        throw new Error(
          `Team "${args.teamId}" not found. Please make sure the team exists.`,
        );
      }

      const updateData: any = {};
      if (args.name) updateData.name = args.name;

      // Resolve project by name if provided
      if (args.projectId) {
        const resolvedProjectId = await this.resolveProjectId(args.projectId);
        if (!resolvedProjectId) {
          throw new Error(
            `Project "${args.projectId}" not found. Please make sure the project exists.`,
          );
        }
        updateData.projectId = resolvedProjectId;
      }

      // Resolve owner by name if provided
      if (args.ownerId) {
        const resolvedOwnerId = await this.resolveUserId(args.ownerId);
        if (!resolvedOwnerId) {
          throw new Error(
            `User "${args.ownerId}" not found. Please make sure the user exists.`,
          );
        }
        updateData.ownerId = resolvedOwnerId;
      }

      const team = await this.teamsService.update(resolvedTeamId, updateData);
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
      const resolvedTeamId = await this.resolveTeamId(args.teamId);
      if (!resolvedTeamId) {
        throw new Error(
          `Team "${args.teamId}" not found. Please make sure the team exists in the system.`,
        );
      }

      await this.teamsService.remove(resolvedTeamId);
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
      const resolvedProjectId = await this.resolveProjectId(args.projectId);
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
      const resolvedProjectId = await this.resolveProjectId(args.projectId);
      if (!resolvedProjectId) {
        throw new Error(
          `Project "${args.projectId}" not found. Please make sure the project exists.`,
        );
      }

      await this.projectsService.remove(resolvedProjectId);
      return { deleted: true, projectId: resolvedProjectId };
    } catch (error) {
      throw new Error(`Failed to delete project: ${error.message}`);
    }
  }
}
