/**
 * Answer generation prompt
 * Generates contextual answers based on retrieved documents
 */

// Intent-specific instructions for answer formatting
export const ANSWER_INSTRUCTIONS: Record<string, string> = {
  requirements: 'List required fields. Use bullets. Note optional fields.',
  statistics: 'Show numbers clearly. Use structured format.',
  status: 'State current status directly. Be factual.',
  list: 'Show items as bullet list with key details.',
  analysis: 'Compare systematically. Highlight differences.',
  help: 'Explain capabilities. Give examples.',
};

export function buildGenerateAnswerPrompt(
  query: string,
  context: string,
  historyText: string,
  intentType?: string,
): string {
  const sysInst =
    ANSWER_INSTRUCTIONS[intentType || ''] ||
    'Answer based on context. Be concise.';

  return `ROLE: Task management assistant.
RULES: ${sysInst} If no answer in context, say so.

CONTEXT:
${context}

${historyText ? `HISTORY:\n${historyText}\n` : ''}Q: ${query}

A:`;
}

/**
 * Get temperature setting based on intent type
 */
export function getAnswerTemperature(intentType?: string): number {
  // Lower temp for stats (precision), higher for analysis
  return intentType === 'statistics' ? 0.3 : 0.7;
}
