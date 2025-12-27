/**
 * Query classification prompt
 * Classifies user intent type and identifies involved entities for routing
 *
 * OPTIMIZED: Removed redundant 'intent' field - now derived from type + entities
 * This reduces LLM tokens by ~30% and eliminates type/intent mismatches
 */
export function buildClassifyQueryPrompt(
  query: string,
  historyContext: string,
): string {
  return `Classify the query TYPE and identify ALL entities involved.

${historyContext ? `HISTORY:\n${historyContext}\n` : ''}MSG: "${query}"

CRITICAL DISTINCTION:
- COMMAND = User wants to DO something NOW ("delete X", "create a task", "assign X to Y")
- QUESTION = User is ASKING about something ("when was X created?", "who created X?")

TYPES (what operation):
- delete: COMMAND to remove entity ("delete user John", "remove this task")
- create: COMMAND to make new entity ("create a task", "add new user")  
- update: COMMAND to modify entity ("update status", "assign X to Y", "reassign")
- question: QUESTION about entities ("when was X created?", "who made this?")
- search: Finding specific entity ("find user John", "show task #5")
- list: Show multiple entities ("list all users", "show tasks")
- statistics: Counts/numbers ("how many tasks?", "total users")

CRITICAL: "assign" = UPDATE operation!

ENTITIES (all types mentioned or implied):
- user: Person, member, assignee, owner (names like "John", "Sarah", "youssef")
- task: Todo, assignment, work item, ticket
- team: Group, squad, department
- project: Initiative, program, workspace

ENTITY RULES:
1. Person NAMES are "user" entities ("assign to youssef" → user)
2. Actions like "assign", "move", "add member" → ALWAYS include "user"
3. "assign task to team" → task AND user AND team
4. Look at HISTORY to infer entities from previous messages

EXAMPLES:
- "when was seleman created?" → type: question | entities: [user]
- "create user John" → type: create | entities: [user]
- "delete user bassem" → type: delete | entities: [user]
- "create task for John" → type: create | entities: [task, user]
- "assign task to John" → type: update | entities: [task, user]
- "move sarah to backend team" → type: update | entities: [user, team]
- "delete the project" → type: delete | entities: [project]
- "who deleted the task?" → type: question | entities: [task]
- "show all tasks" → type: list | entities: [task]
- "how many users?" → type: statistics | entities: [user]

Output format (2 lines only):
type: [type]
entities: [entity1, entity2]`;
}
