import { Injectable, Logger } from '@nestjs/common';
import { LLMCacheService } from './llm-cache.service';

/**
 * LLM-based entity extraction from queries
 * Replaces brittle keyword matching with semantic understanding
 */
@Injectable()
export class EntityExtractionService {
  private readonly logger = new Logger(EntityExtractionService.name);

  constructor(private readonly llmCacheService: LLMCacheService) {}

  /**
   * Extract ALL entity types mentioned in a query using LLM
   * Returns array of entity types: ['user', 'task', 'team', 'project']
   */
  async extractEntityTypes(
    query: string,
    history: string = '',
  ): Promise<string[]> {
    const prompt = `Analyze this query and identify ALL entity types mentioned or implied.

${history ? `CONVERSATION HISTORY:\n${history}\n` : ''}CURRENT QUERY: "${query}"

ENTITY TYPES:
- user: Person, member, assignee, owner (names like "John", "Sarah", "youssef")
- task: Todo, assignment, work item, ticket
- team: Group, squad, department
- project: Initiative, program, workspace

CRITICAL RULES:
1. Person NAMES are "user" entities (e.g., "assign to youssef" → user)
2. Actions like "assign", "move", "add member" → ALWAYS include "user"
3. "assign task to team" → task AND user AND team (assignee implied)
4. Look at HISTORY to infer entities (e.g., previously mentioned task)

EXAMPLES:
Query: "assign it to youssef" → ["task", "user"]
Query: "move sarah to backend team" → ["user", "team"]
Query: "create task for john" → ["task", "user"]
Query: "delete the project" → ["project"]
Query: "show all tasks" → ["task"]

OUTPUT (JSON array only):
["type1", "type2"]`;

    try {
      const response = await this.llmCacheService.cachedCall(prompt, {
        temperature: 0.1,
      });

      // Parse JSON array - handle both single-line and multi-line JSON
      const trimmed = response.trim();

      // Try to find JSON array in the response
      const match = trimmed.match(/\[[\s\S]*?\]/);
      if (!match) {
        this.logger.warn(`No array found in LLM response: ${response}`);
        return [];
      }

      // Parse the matched JSON array directly
      const entities = JSON.parse(match[0]);

      if (!Array.isArray(entities)) {
        this.logger.warn(`Parsed result is not an array: ${entities}`);
        return [];
      }

      this.logger.debug(`🔍 Extracted entities: ${entities.join(', ')}`);
      return entities;
    } catch (error) {
      this.logger.error(
        `Entity extraction failed: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  /**
   * Extract person names from query
   * Used to improve user entity search
   */
  async extractPersonNames(query: string): Promise<string[]> {
    const prompt = `Extract ALL person names from this query.

QUERY: "${query}"

RULES:
- Look for proper nouns (capitalized names)
- Common names: John, Sarah, Mohamed, Youssef, etc.
- Email-like patterns without @domain

OUTPUT (comma-separated or "none"):`;

    try {
      const response = await this.llmCacheService.cachedCall(prompt, {
        temperature: 0.0,
      });

      if (response.toLowerCase().includes('none')) {
        return [];
      }

      const names = response
        .split(/[,\n]/)
        .map((n) => n.trim())
        .filter((n) => n.length > 0 && n.length < 30);

      this.logger.debug(`👤 Extracted names: ${names.join(', ')}`);
      return names;
    } catch (error) {
      this.logger.error(`Name extraction failed: ${error.message}`);
      return [];
    }
  }
}
