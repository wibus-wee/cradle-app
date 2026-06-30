export const CODEX_AUTH_MODE_API_KEY = 'apikey'
export const CODEX_AUTH_MODE_CHATGPT = 'chatgptAuthTokens'
export const CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN = 'personalAccessToken'
export const CODEX_AUTH_MODE_BEDROCK_API_KEY = 'bedrockApiKey'

export type CodexAuthModeValue
  = | typeof CODEX_AUTH_MODE_API_KEY
    | typeof CODEX_AUTH_MODE_CHATGPT
    | typeof CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN
    | typeof CODEX_AUTH_MODE_BEDROCK_API_KEY

export const CODEX_AUTH_MODE_OPTIONS: Array<{ value: CodexAuthModeValue, label: string }> = [
  { value: CODEX_AUTH_MODE_API_KEY, label: 'API Key' },
  { value: CODEX_AUTH_MODE_CHATGPT, label: 'ChatGPT' },
  { value: CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN, label: 'PAT' },
  { value: CODEX_AUTH_MODE_BEDROCK_API_KEY, label: 'Bedrock' },
]

export function normalizeCodexAuthMode(value: string | null | undefined): CodexAuthModeValue {
  switch (value) {
    case 'chatgpt':
    case CODEX_AUTH_MODE_CHATGPT:
      return CODEX_AUTH_MODE_CHATGPT
    case CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN:
      return CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN
    case CODEX_AUTH_MODE_BEDROCK_API_KEY:
      return CODEX_AUTH_MODE_BEDROCK_API_KEY
    default:
      return CODEX_AUTH_MODE_API_KEY
  }
}

export function codexSecretKindForAuthMode(
  authMode: CodexAuthModeValue,
  fallbackKind: string,
): string {
  switch (authMode) {
    case CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN:
      return 'codex-personal-access-token'
    case CODEX_AUTH_MODE_BEDROCK_API_KEY:
      return 'codex-bedrock-api-key'
    default:
      return fallbackKind
  }
}

export function codexCredentialInputLabel(authMode: CodexAuthModeValue): string {
  switch (authMode) {
    case CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN:
      return 'Personal access token'
    case CODEX_AUTH_MODE_BEDROCK_API_KEY:
      return 'Bedrock API key'
    default:
      return 'API key'
  }
}

export function codexCredentialPlaceholder(authMode: CodexAuthModeValue, hasCredential: boolean): string {
  if (hasCredential) {
    return 'Configured · type to replace'
  }
  switch (authMode) {
    case CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN:
      return 'Paste token'
    case CODEX_AUTH_MODE_BEDROCK_API_KEY:
      return 'Bearer token'
    default:
      return 'sk-...'
  }
}

export function codexAuthModeFromCredentialKind(kind: string | null | undefined): CodexAuthModeValue | null {
  switch (kind) {
    case 'chatgpt-auth':
      return CODEX_AUTH_MODE_CHATGPT
    case 'codex-personal-access-token':
      return CODEX_AUTH_MODE_PERSONAL_ACCESS_TOKEN
    case 'codex-bedrock-api-key':
      return CODEX_AUTH_MODE_BEDROCK_API_KEY
    default:
      return null
  }
}
