import { Injectable } from '@nestjs/common';
import { ConversationHistory } from './conversation.service';
import { RetrievedDoc } from './search.service';

/**
 * Centralized formatting utilities for RAG services.
 * Eliminates duplicate formatting logic across services.
 */
@Injectable()
export class FormattingService {
  /**
   * Format conversation history for prompts (compact format)
   * Handles summary role for condensed conversation history
   */
  formatHistoryCompact(
    history: ConversationHistory[],
    maxMessages: number = 10,
  ): string {
    const recentHistory = history.slice(-maxMessages);
    if (recentHistory.length === 0) return '';

    return recentHistory
      .map((h) => {
        if (h.role === 'summary') {
          return `[CONTEXT] ${h.content}`;
        }
        return `[${h.role[0].toUpperCase()}] ${h.content}`;
      })
      .join('\n');
  }

  /**
   * Format conversation history for prompts (detailed format)
   * Handles summary role for condensed conversation history
   */
  formatHistoryDetailed(
    history: ConversationHistory[],
    maxMessages: number = 10,
  ): string {
    const recentHistory = history.slice(-maxMessages);
    if (recentHistory.length === 0) return 'none';

    return recentHistory
      .map((h) => {
        if (h.role === 'summary') {
          return `[PREVIOUS CONTEXT] ${h.content}`;
        }
        return `[${h.role === 'user' ? 'USER' : 'ASSISTANT'}] ${h.content}`;
      })
      .join('\n');
  }

  /**
   * Build context string from retrieved documents
   */
  buildContextFromDocs(docs: RetrievedDoc[]): string {
    return docs
      .map(
        (doc, idx) =>
          `[${idx + 1}] ${doc.entityType.toUpperCase()}: ${doc.text}`,
      )
      .join('\n\n');
  }

  /**
   * Build retrieval context with IDs for action execution
   * ROOT FIX: Shows STRUCTURED data with explicit UUIDs for LLM
   */
  buildRetrievalContext(docs: RetrievedDoc[]): string {
    if (docs.length === 0) return 'No matching entities found in database.';

    return docs
      .map((doc, i) => {
        const m = doc.metadata || {};
        const id = doc.entityId || m.entity_id || 'unknown';

        // ROOT FIX: Structured format with explicit IDs
        switch (doc.entityType) {
          case 'user':
            return `[${i + 1}] USER: id="${id}" name="${m.user_name || 'unknown'}" email="${m.user_email || 'unknown'}" team="${m.team_name || 'none'}"`;
          case 'task':
            return `[${i + 1}] TASK: id="${id}" title="${m.task_title || doc.text?.substring(0, 50) || 'unknown'}" status="${m.task_status || 'unknown'}" assignee="${m.assignee_name || 'unassigned'}"`;
          case 'team':
            return `[${i + 1}] TEAM: id="${id}" name="${m.team_name || 'unknown'}" project="${m.project_name || 'none'}" owner="${m.owner_name || 'unknown'}"`;
          case 'project':
            return `[${i + 1}] PROJECT: id="${id}" name="${m.project_name || 'unknown'}" description="${(m.project_description || '').substring(0, 50)}"`;
          default:
            return `[${i + 1}] ${doc.entityType.toUpperCase()}: id="${id}" ${doc.text?.substring(0, 100) || ''}`;
        }
      })
      .join('\n');
  }

  /**
   * Truncate text with ellipsis
   */
  truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Format entity type map for intent to entity mapping
   * CRITICAL: Maps classification intent to entity type for function naming
   */
  getEntityTypeFromIntent(intent: string): string | null {
    const intentToEntity: Record<string, string> = {
      task_management: 'task',
      user_info: 'user',
      user_management: 'user', // Added: for user CRUD operations
      team_info: 'team',
      team_management: 'team', // Added: for team CRUD operations
      project_info: 'project',
      project_management: 'project', // Added: for project CRUD operations
      general: 'task', // Default fallback
    };
    return intentToEntity[intent] || null;
  }

  /**
   * Format function name from classification
   */
  formatFunctionName(classification: { type: string; intent: string }): string {
    const entity =
      this.getEntityTypeFromIntent(classification.intent) || 'task';
    return `${classification.type}_${entity}`;
  }

  /**
   * Parse JSON from LLM response
   * ROOT FIX: Handle malformed JSON with extra braces (common LLM error)
   */
  extractJsonFromResponse(response: string): any | null {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let jsonStr = jsonMatch[0];

    // First try direct parse
    try {
      return JSON.parse(jsonStr);
    } catch {
      // ROOT FIX: Try to fix common LLM JSON errors

      // 1. Remove extra trailing braces (e.g., "}}" -> "}")
      // Count opening and closing braces to balance them
      let openCount = 0;
      let closeCount = 0;
      for (const char of jsonStr) {
        if (char === '{') openCount++;
        if (char === '}') closeCount++;
      }

      // If more closing than opening, trim the extras from the end
      if (closeCount > openCount) {
        const excess = closeCount - openCount;
        // Remove excess closing braces from the end
        for (let i = 0; i < excess; i++) {
          const lastBrace = jsonStr.lastIndexOf('}');
          if (lastBrace !== -1) {
            jsonStr =
              jsonStr.substring(0, lastBrace) +
              jsonStr.substring(lastBrace + 1);
          }
        }
      }

      // Try parsing the fixed string
      try {
        return JSON.parse(jsonStr);
      } catch {
        return null;
      }
    }
  }

  /**
   * Format action result message
   */
  formatActionResult(action: string, entityType: string, result: any): string {
    const templates: Record<string, Record<string, (r: any) => string>> = {
      create: {
        task: (r) =>
          `✅ Task created successfully!\n\n**Task Details:**\n- Title: ${r.title}\n- Description: ${r.description || 'N/A'}\n- Status: ${r.status}\n- Assigned to: ${r.assignedTo || 'Unassigned'}\n- Deadline: ${r.deadline ? new Date(r.deadline).toLocaleDateString() : 'N/A'}\n- Task ID: ${r.id}`,
        user: (r) =>
          `✅ User created successfully!\n\n**User Details:**\n- Name: ${r.name}\n- Email: ${r.email}\n- Role: ${r.role}\n- Team ID: ${r.teamId || 'N/A'}\n- User ID: ${r.id}`,
        team: (r) =>
          `✅ Team created successfully!\n\n**Team Details:**\n- Name: ${r.name}\n- Project ID: ${r.projectId}\n- Owner ID: ${r.ownerId}\n- Team ID: ${r.id}`,
        project: (r) =>
          `✅ Project created successfully!\n\n**Project Details:**\n- Name: ${r.name}\n- Description: ${r.description || 'N/A'}\n- Project ID: ${r.id}`,
      },
      update: {
        task: (r) =>
          `✅ Task updated successfully!\n\n**Updated Task:**\n- Title: ${r.title}\n- Status: ${r.status}\n- Description: ${r.description || 'N/A'}`,
        user: (r) =>
          `✅ User updated successfully!\n\n**Updated User:**\n- Name: ${r.name}\n- Email: ${r.email}\n- Role: ${r.role || 'N/A'}\n- Team ID: ${r.teamId || 'N/A'}`,
        team: (r) =>
          `✅ Team updated successfully!\n\n**Updated Team:**\n- Name: ${r.name}\n- Project ID: ${r.projectId}\n- Owner ID: ${r.ownerId}`,
        project: (r) =>
          `✅ Project updated successfully!\n\n**Updated Project:**\n- Name: ${r.name}\n- Description: ${r.description || 'N/A'}`,
      },
      delete: {
        task: (r) =>
          `✅ Task deleted successfully! (Task ID: ${r.taskId || r.id})`,
        user: (r) =>
          `✅ User deleted successfully! (User ID: ${r.userId || r.id})`,
        team: (r) =>
          `✅ Team deleted successfully! (Team ID: ${r.teamId || r.id})`,
        project: (r) =>
          `✅ Project deleted successfully! (Project ID: ${r.projectId || r.id})`,
      },
    };

    const actionTemplates = templates[action];
    if (!actionTemplates) return `✅ Action ${action} completed successfully!`;

    const entityTemplate = actionTemplates[entityType];
    if (!entityTemplate) return `✅ ${entityType} ${action}d successfully!`;

    return entityTemplate(result);
  }
}
