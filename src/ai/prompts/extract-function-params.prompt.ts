/**
 * Function parameter extraction prompt
 * Extracts and accumulates parameters from conversation for function calls
 * ROOT FIX: More explicit about history accumulation and entity resolution
 */
export function buildExtractFunctionParamsPrompt(
  funcName: string,
  paramList: string,
  retrievalContext: string,
  historyContext: string,
  query: string,
  primaryIdParam: string,
): string {
  return `ROLE: Extract function parameters by COMBINING information from HISTORY and CURRENT REQUEST.

FUNCTION: ${funcName}
PARAMETERS:
${paramList}

DATABASE ENTITIES (use these UUIDs!):
${retrievalContext}

CONVERSATION HISTORY (extract missing parameters from here!):
${historyContext}

CURRENT REQUEST: "${query}"

CRITICAL INSTRUCTIONS:
1. LOOK AT HISTORY FIRST - Find the entity being referenced (e.g., task created in previous turn)
2. ACCUMULATE parameters from BOTH the history AND the current request
3. For references like "it", "the task", "that project" → Find entity ID in HISTORY
4. For person names → Match against DATABASE ENTITIES (e.g., "youssef" → find user UUID)
5. COMBINE partial information (e.g., name from turn 1 + email from turn 2)
6. Use EXACT parameter names from PARAMETERS list

EXAMPLES:
- History: [USER] "create task 'Implement RAG'" [ASSISTANT] "✅ Created task ID: abc-123"
  Current: "assign it to youssef"
  → Find taskId="abc-123" in history, find youssef UUID in DB entities
  → {"taskId":"abc-123","assignedTo":"<youssef-uuid>"}

- History: [USER] "create user john" [ASSISTANT] "need email" 
  Current: "his email is john@test.com"
  → {"name":"john","email":"john@test.com"}

- History: [USER] "make task high priority" [ASSISTANT] "which task?"
  Current: "the RAG optimization one"
  → Find task with "RAG optimization" in history
  → {"taskId":"<found-task-uuid>","priority":"high"}

OUTPUT (JSON only, combine ALL extracted parameters):
{"name":"${funcName}","arguments":{"${primaryIdParam}":"<extracted-value>"}}`;
}
