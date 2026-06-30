export const CLAUDE_AUTH_MODE_API_KEY = 'apiKey'
export const CLAUDE_AUTH_MODE_CLAUDE_AI = 'claudeAi'

export type ClaudeAuthModeValue
  = | typeof CLAUDE_AUTH_MODE_API_KEY
    | typeof CLAUDE_AUTH_MODE_CLAUDE_AI

export const CLAUDE_AUTH_MODE_OPTIONS: Array<{ value: ClaudeAuthModeValue, label: string }> = [
  { value: CLAUDE_AUTH_MODE_API_KEY, label: 'API Key' },
  { value: CLAUDE_AUTH_MODE_CLAUDE_AI, label: 'Claude.ai' },
]

/**
 * Claude Agent auth modes live on the same `config.authMode` field as Codex
 * modes, but only apply when `providerKind === 'anthropic'`. Unknown or Codex
 * values collapse to the API key default so a stale value never blocks the UI.
 */
export function normalizeClaudeAuthMode(value: string | null | undefined): ClaudeAuthModeValue {
  switch (value) {
    case CLAUDE_AUTH_MODE_CLAUDE_AI:
      return CLAUDE_AUTH_MODE_CLAUDE_AI
    default:
      return CLAUDE_AUTH_MODE_API_KEY
  }
}

export function claudeCredentialPlaceholder(
  hasCredential: boolean,
  _authMode: ClaudeAuthModeValue = CLAUDE_AUTH_MODE_API_KEY,
): string {
  if (hasCredential) {
    return 'Configured · type to replace'
  }
  return 'sk-ant-...'
}
