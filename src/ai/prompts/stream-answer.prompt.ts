/**
 * Streaming answer generation prompt
 * Optimized prompt for streaming responses
 */
export function buildStreamAnswerPrompt(
  query: string,
  context: string,
  historyText: string,
): string {
  return `ROLE: Task assistant. Answer from context only. Be concise.

CONTEXT:
${context}

${historyText ? `HISTORY:\n${historyText}\n` : ''}Q: ${query}

A:`;
}
