/**
 * Query reformulation prompt
 * Generates search keyword variations for better retrieval
 */
export function buildReformulateQueryPrompt(
  query: string,
  historyContext: string,
): string {
  return `Extract KEY SEARCH TERMS and reformulate query for better database retrieval.

${historyContext ? `HISTORY:\n${historyContext}\n` : ''}QUERY: "${query}"

TASK: Generate 3-4 focused search variations:
1. Extract 3-5 core keywords/entities (names, tasks, projects, statuses)
2. Create semantic variations that preserve intent
3. Expand abbreviations and implicit references

EXAMPLES:
Input: "show john's tasks"
Output:
john tasks
tasks assigned john
john task list

Input: "overdue items for backend team"
Output:
overdue backend team
backend team overdue tasks
overdue items team backend

Input: "what did sarah work on?"
Output:
sarah tasks
sarah assigned work
tasks sarah working

RULES:
- Keep each variation SHORT (2-5 words)
- Include entity names if present
- Focus on searchable keywords
- Don't add extra context

OUTPUT (one per line, 3-4 variations):`;
}
