/**
 * Error formatting prompt
 * Converts technical errors to user-friendly messages
 */
export function buildFormatErrorPrompt(
  errorMessage: string,
  userQuery: string,
): string {
  return `User asked: "${userQuery}"
Error: ${errorMessage}

Explain in 1-2 plain sentences (no technical jargon). What went wrong + what to do:`;
}
