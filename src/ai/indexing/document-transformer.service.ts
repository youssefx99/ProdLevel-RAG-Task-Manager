import { Injectable, Logger } from '@nestjs/common';
import { User } from '../../users/user.entity';
import { Team } from '../../teams/team.entity';
import { Project } from '../../projects/project.entity';
import { Task, TaskStatus } from '../../tasks/task.entity';

export interface TransformedDocument {
  text: string;
  metadata: Record<string, any>;
}

@Injectable()
export class DocumentTransformerService {
  private readonly logger = new Logger(DocumentTransformerService.name);

  /**
   * Transform User entity to searchable document
   */
  transformUser(user: User): TransformedDocument {
    try {
      // Build rich text representation
      const textParts: string[] = [];

      // Basic info
      textParts.push(`User Profile: ${user.name}`);
      textParts.push(`${user.name}'s email is ${user.email}`);
      textParts.push(`${user.name} is a ${this.formatRole(user.role)}`);

      // Team information
      if (user.team) {
        textParts.push(`${user.name} belongs to ${user.team.name} team`);
        if (user.team.project) {
          textParts.push(`Working on project: ${user.team.project.name}`);
        }
      } else {
        textParts.push(`${user.name} has no team assigned`);
      }

      // Tasks information
      if (user.tasks && user.tasks.length > 0) {
        const taskSummary = this.summarizeArray(
          user.tasks.map((t) => t.title),
          'task',
        );
        textParts.push(`Assigned tasks: ${taskSummary}`);
        textParts.push(`Total tasks: ${user.tasks.length}`);

        // Task status breakdown
        const statusBreakdown = this.getTaskStatusBreakdown(
          user.tasks,
          user.name,
        );
        if (statusBreakdown) {
          textParts.push(statusBreakdown);
        }
      } else {
        textParts.push(`${user.name} has no tasks assigned`);
      }

      // Dates
      textParts.push(
        `${user.name} joined on ${this.formatDate(user.createdAt)}`,
      );
      textParts.push(
        `Profile last updated: ${this.formatDate(user.updatedAt)}`,
      );

      const text = textParts.join('\n');

      // Extract metadata for filtering
      const metadata = {
        entity_type: 'user',
        entity_id: user.id,
        user_name: user.name,
        user_email: user.email,
        user_role: user.role,
        team_id: user.teamId || null,
        team_name: user.team?.name || null,
        project_id: user.team?.projectId || null,
        project_description: user.team?.project?.description || null,
        tasks_count: user.tasks?.length || 0,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
      };

      return { text, metadata };
    } catch (error) {
      this.logger.error(
        `Failed to transform user ${user.id}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Transform Team entity to searchable document
   */
  transformTeam(team: Team): TransformedDocument {
    try {
      const textParts: string[] = [];

      // Basic info
      textParts.push(`Team: ${team.name}`);

      // Owner information
      if (team.owner) {
        textParts.push(
          `${team.name} is led by ${team.owner.name} (${team.owner.email})`,
        );
        textParts.push(`Lead role: ${this.formatRole(team.owner.role)}`);
      }

      // Project information
      if (team.project) {
        textParts.push(`${team.name} works on ${team.project.name} project`);
        if (team.project.description) {
          textParts.push(`Project goal: ${team.project.description}`);
        }
      }

      // Members information
      if (team.users && team.users.length > 0) {
        const membersSummary = this.summarizeArray(
          team.users.map((u) => u.name),
          'member',
        );
        textParts.push(`${team.name} members: ${membersSummary}`);
        textParts.push(`${team.name} has ${team.users.length} members`);

        // Role breakdown
        const roleBreakdown = this.getRoleBreakdown(team.users);
        if (roleBreakdown) {
          textParts.push(roleBreakdown);
        }
      } else {
        textParts.push(`${team.name} has no members yet`);
      }

      // Dates
      textParts.push(
        `${team.name} created on ${this.formatDate(team.createdAt)}`,
      );
      textParts.push(`Last updated: ${this.formatDate(team.updatedAt)}`);

      const text = textParts.join('\n');

      // Extract metadata
      const metadata = {
        entity_type: 'team',
        entity_id: team.id,
        team_name: team.name,
        owner_id: team.ownerId,
        owner_name: team.owner?.name || null,
        project_id: team.projectId,
        project_name: team.project?.name || null,
        members_count: team.users?.length || 0,
        created_at: team.createdAt.toISOString(),
        updated_at: team.updatedAt.toISOString(),
      };

      return { text, metadata };
    } catch (error) {
      this.logger.error(
        `Failed to transform team ${team.id}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Transform Project entity to searchable document
   */
  transformProject(project: Project): TransformedDocument {
    try {
      const textParts: string[] = [];

      // Basic info
      textParts.push(`Project: ${project.name}`);

      if (project.description) {
        textParts.push(`${project.name} aims to: ${project.description}`);
      }

      // Teams information
      if (project.teams && project.teams.length > 0) {
        const teamsSummary = this.summarizeArray(
          project.teams.map((t) => t.name),
          'team',
        );
        textParts.push(`${project.name} includes teams: ${teamsSummary}`);
        textParts.push(`${project.name} has ${project.teams.length} teams`);

        // Calculate total members across all teams
        const totalMembers = project.teams.reduce(
          (sum, team) => sum + (team.users?.length || 0),
          0,
        );
        textParts.push(
          `${project.name} has ${totalMembers} total members across all teams`,
        );

        // List team leads
        const teamLeads = project.teams
          .filter((t) => t.owner)
          .map((t) => `${t.name} (${t.owner.name})`);
        if (teamLeads.length > 0) {
          const leadsSummary = this.summarizeArray(teamLeads, 'team lead');
          textParts.push(`Team Leads: ${leadsSummary}`);
        }
      } else {
        textParts.push(`${project.name} has no teams yet`);
      }

      // Dates
      textParts.push(
        `${project.name} started on ${this.formatDate(project.createdAt)}`,
      );
      textParts.push(`Last updated: ${this.formatDate(project.updatedAt)}`);

      const text = textParts.join('\n');

      // Extract metadata
      const metadata = {
        entity_type: 'project',
        entity_id: project.id,
        project_name: project.name,
        project_description: project.description || null,
        teams_count: project.teams?.length || 0,
        total_members:
          project.teams?.reduce(
            (sum, team) => sum + (team.users?.length || 0),
            0,
          ) || 0,
        created_at: project.createdAt.toISOString(),
        updated_at: project.updatedAt.toISOString(),
      };

      return { text, metadata };
    } catch (error) {
      this.logger.error(
        `Failed to transform project ${project.id}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Transform Task entity to searchable document
   */
  transformTask(task: Task): TransformedDocument {
    try {
      const textParts: string[] = [];

      // Basic info
      textParts.push(`Task: ${task.title}`);

      if (task.description) {
        textParts.push(`Details: ${task.description}`);
      }

      // Status
      textParts.push(`This task is ${this.formatTaskStatus(task.status)}`);

      // Assignee information
      if (task.assignee) {
        textParts.push(
          `${task.title} is assigned to ${task.assignee.name} (${task.assignee.email})`,
        );
        textParts.push(
          `${task.assignee.name} is a ${this.formatRole(task.assignee.role)}`,
        );

        // Team and project context
        if (task.assignee.team) {
          textParts.push(
            `${task.assignee.name} works in ${task.assignee.team.name} team`,
          );
          if (task.assignee.team.project) {
            textParts.push(
              `Part of ${task.assignee.team.project.name} project`,
            );
          }
        }
      } else {
        textParts.push(`${task.title} is unassigned`);
      }

      // Deadline
      if (task.deadline) {
        textParts.push(`Deadline: ${this.formatDate(task.deadline)}`);

        // Calculate urgency
        const daysUntilDeadline = this.getDaysUntilDeadline(task.deadline);
        if (daysUntilDeadline !== null) {
          if (daysUntilDeadline < 0) {
            textParts.push(`⚠ Overdue by ${Math.abs(daysUntilDeadline)} days`);
          } else if (daysUntilDeadline === 0) {
            textParts.push('⚠ Due today');
          } else if (daysUntilDeadline <= 3) {
            textParts.push(`⚠ Due in ${daysUntilDeadline} days (urgent)`);
          } else {
            textParts.push(`Due in ${daysUntilDeadline} days`);
          }
        }
      } else {
        textParts.push('No deadline set');
      }

      // Dates
      textParts.push(`Created: ${this.formatDate(task.createdAt)}`);
      textParts.push(`Last updated: ${this.formatDate(task.updatedAt)}`);

      const text = textParts.join('\n');

      // Extract metadata
      const daysUntilDeadline = task.deadline
        ? this.getDaysUntilDeadline(task.deadline)
        : null;

      const metadata = {
        entity_type: 'task',
        entity_id: task.id,
        task_title: task.title,
        task_description: task.description || null,
        task_status: task.status,
        assigned_to: task.assignedTo,
        assignee_name: task.assignee?.name || null,
        assignee_email: task.assignee?.email || null,
        team_id: task.assignee?.teamId || null,
        team_name: task.assignee?.team?.name || null,
        project_id: task.assignee?.team?.projectId || null,
        project_name: task.assignee?.team?.project?.name || null,
        deadline: task.deadline ? task.deadline.toISOString() : null,
        is_overdue: daysUntilDeadline !== null ? daysUntilDeadline < 0 : false,
        is_urgent:
          daysUntilDeadline !== null
            ? daysUntilDeadline >= 0 && daysUntilDeadline <= 3
            : false,
        days_until_deadline: daysUntilDeadline,
        created_at: task.createdAt.toISOString(),
        updated_at: task.updatedAt.toISOString(),
      };

      return { text, metadata };
    } catch (error) {
      this.logger.error(
        `Failed to transform task ${task.id}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Helper: Format date to readable string
   */
  private formatDate(date: Date): string {
    if (!date) return 'Unknown';

    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };

    return new Date(date).toLocaleDateString('en-US', options);
  }

  /**
   * Helper: Format user role
   */
  private formatRole(role: string): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  /**
   * Helper: Format task status
   */
  private formatTaskStatus(status: TaskStatus): string {
    const statusMap: Record<TaskStatus, string> = {
      [TaskStatus.TODO]: 'To Do',
      [TaskStatus.IN_PROGRESS]: 'In Progress',
      [TaskStatus.DONE]: 'Done',
    };
    return statusMap[status] || status;
  }

  /**
   * Helper: Summarize array of items
   */
  private summarizeArray(items: string[], itemType: string = 'item'): string {
    const count = items?.length || 0;

    if (count === 0) return `no ${itemType}s available`;
    if (count === 1) return `only one item: ${items[0]}`;
    if (count === 2) return `only two items: ${items[0]} and ${items[1]}`;

    const preview = items.slice(0, 3).join(', ');
    const extra = count - 3;

    return count <= 5
      ? `${preview.replace(/,([^,]*)$/, ' and$1')}` // Last item with "and"
      : `${preview} plus ${extra} more (${count} total ${itemType}s)`;
  }

  /**
   * Helper: Get task status breakdown
   */
  private getTaskStatusBreakdown(
    tasks: Task[],
    userName: string,
  ): string | null {
    if (!tasks || tasks.length === 0) return null;

    const statusCounts = {
      todo: 0,
      in_progress: 0,
      done: 0,
    };

    tasks.forEach((task) => {
      if (task.status === TaskStatus.TODO) statusCounts.todo++;
      else if (task.status === TaskStatus.IN_PROGRESS)
        statusCounts.in_progress++;
      else if (task.status === TaskStatus.DONE) statusCounts.done++;
    });

    const parts: string[] = [];
    if (statusCounts.todo > 0) parts.push(`${statusCounts.todo} to do`);
    if (statusCounts.in_progress > 0)
      parts.push(`${statusCounts.in_progress} in progress`);
    if (statusCounts.done > 0) parts.push(`${statusCounts.done} done`);

    return `Task breakdown for user ${userName}: ${parts.join(', ')}`;
  }

  /**
   * Helper: Get role breakdown for team members
   */
  private getRoleBreakdown(users: User[]): string | null {
    if (!users || users.length === 0) return null;

    const roleCounts: Record<string, number> = {};
    users.forEach((user) => {
      roleCounts[user.role] = (roleCounts[user.role] || 0) + 1;
    });

    const parts = Object.entries(roleCounts).map(
      ([role, count]) =>
        `${count} ${this.formatRole(role)}${count > 1 ? 's' : ''}`,
    );

    return `Roles: ${parts.join(', ')}`;
  }

  /**
   * Helper: Calculate days until deadline
   */
  private getDaysUntilDeadline(deadline: Date): number | null {
    if (!deadline) return null;

    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }

  /**
   * Sanitize text to remove sensitive information
   */
  sanitizeText(text: string): string {
    if (!text) return '';

    // Remove potential sensitive patterns (passwords, tokens, etc.)
    let sanitized = text;

    // Remove password-like patterns
    sanitized = sanitized.replace(/password[:\s]*\S+/gi, '[REDACTED]');
    sanitized = sanitized.replace(/token[:\s]*\S+/gi, '[REDACTED]');
    sanitized = sanitized.replace(/api[_-]?key[:\s]*\S+/gi, '[REDACTED]');
    sanitized = sanitized.replace(/secret[:\s]*\S+/gi, '[REDACTED]');

    return sanitized;
  }
}
