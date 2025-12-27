/**
 * Quick intent classification prompt
 * Used for fast classification of short, ambiguous messages
 */
export function buildQuickIntentPrompt(query: string): string {
  return `Classify: "${query}"
Output ONE word: greeting|goodbye|thank|none`;
}
