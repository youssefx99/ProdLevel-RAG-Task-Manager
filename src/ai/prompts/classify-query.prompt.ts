/**
 * Query classification prompt
 * Classifies user intent for routing to appropriate handlers
 */
export function buildClassifyQueryPrompt(
  query: string,
  historyContext: string,
): string {
  return `Classify the user's INTENT.

${historyContext ? `HISTORY:\n${historyContext}\n` : ''}MSG: "${query}"

CRITICAL DISTINCTION:
- COMMAND = User wants to DO something NOW ("delete X", "create a task", "assign X to Y")
- QUESTION = User is ASKING about something ("when was X created?", "who created X?")

TYPES:
- delete: COMMAND to remove entity ("delete user John", "remove this task")
- create: COMMAND to make new entity ("create a task", "add new user", "create user called X")  
- update: COMMAND to modify entity ("update task status", "change user email", "ASSIGN X to Y", "reassign task")
- question: QUESTION about entities ("when was user created?", "who made this?", "what is X?")
- search: Finding specific entity ("find user John", "show task #5")
- list: Show multiple entities ("list all users", "show tasks")
- statistics: Counts/numbers ("how many tasks?", "total users")

CRITICAL: "assign" = UPDATE operation!
- "assign task to John" → type: update intent: task_management
- "assign user to team" → type: update intent: team_management
- "reassign project" → type: update intent: project_management

INTENT (focus area):
- task_management: operations on tasks
- user_info: QUESTIONS about users
- user_management: COMMANDS for user CRUD (create/update/delete user)
- team_info: QUESTIONS about teams
- team_management: COMMANDS for team CRUD (create/update/delete team)
- project_info: QUESTIONS about projects
- project_management: COMMANDS for project CRUD (create/update/delete project)
- general: other queries

EXAMPLES:
- "when was seleman created?" → type: question intent: user_info (asking ABOUT user)
- "create user John" → type: create intent: user_management (COMMAND to create user)
- "create new user called bassem" → type: create intent: user_management
- "delete user bassem" → type: delete intent: user_management
- "update user email" → type: update intent: user_management
- "create task for John" → type: create intent: task_management
- "assign task to John" → type: update intent: task_management (COMMAND to update assignedTo)
- "delete the project" → type: delete intent: project_management (COMMAND)
- "who deleted the task?" → type: question intent: task_management (asking ABOUT deletion)

Output:
type: [type]
intent: [intent]`;
}
