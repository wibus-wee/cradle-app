import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  CODEX_BEDROCK_API_KEY_ENV,
  CODEX_BEDROCK_REGION_ENV,
  CODEX_PERSONAL_ACCESS_TOKEN_ENV,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'

/**
 * Creates a fingerprint for Codex app-server host resource that includes only
 * process-level compatibility within a host scope. Thread config such as
 * approval_policy, sandbox_mode, and model is omitted because it is supplied by
 * thread requests. Cradle chat/workspace env is also omitted because chat-session
 * isolation is owned by the host scope id, not by this resource fingerprint.
 */
export function createCodexAppServerHostFingerprint(input: {
  options: CodexAppServerClientOptions
  chatgptAuth: CodexChatgptAuthCredential | null
}): string {
  // Extract only process-level config that affects app-server lifetime:
  // - baseUrl and model_provider affect which API the process connects to
  // - Other config keys (approval_policy, sandbox_mode, model, etc.) are thread-level
  const processLevelConfig = input.options.config
    ? extractProcessLevelConfig(input.options.config)
    : null
  const processLevelEnv = input.options.env
    ? extractProcessLevelEnv(input.options.env)
    : null

  return JSON.stringify({
    apiKey: input.options.apiKey ?? null,
    chatgptAuth: input.chatgptAuth
      ? {
          credentialRef: input.chatgptAuth.credentialRef,
          accountId: input.chatgptAuth.chatgptAccountId,
          planType: input.chatgptAuth.chatgptPlanType,
        }
      : null,
    codexPath: input.options.codexPath ?? null,
    processLevelConfig: stableJson(processLevelConfig),
    processLevelEnv: stableJson(processLevelEnv),
    userAgentMode: input.options.userAgentMode ?? null,
  })
}

function extractProcessLevelConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const processKeys = ['model_provider', 'model_providers']
  const processConfig: Record<string, unknown> = {}
  for (const key of processKeys) {
    if (key in config) {
      processConfig[key] = config[key]
    }
  }
  return Object.keys(processConfig).length > 0 ? processConfig : null
}

function extractProcessLevelEnv(env: Record<string, string | undefined>): Record<string, string> | null {
  const processEnv: Record<string, string> = {}
  for (const key of [
    CODEX_PERSONAL_ACCESS_TOKEN_ENV,
    CODEX_BEDROCK_API_KEY_ENV,
    CODEX_BEDROCK_REGION_ENV,
  ]) {
    const value = env[key]
    if (value) {
      processEnv[key] = value
    }
  }
  return Object.keys(processEnv).length > 0 ? processEnv : null
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    )
  }
  return value
}
