import { createHash } from 'node:crypto'

import stringify from 'safe-stable-stringify'

import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  CODEX_BEDROCK_API_KEY_ENV,
  CODEX_BEDROCK_REGION_ENV,
  CODEX_PERSONAL_ACCESS_TOKEN_ENV,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'
import { projectCodexProcessConfig } from './process-config'

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
  const processLevelConfig = projectCodexProcessConfig(input.options.config)
  const processLevelEnv = input.options.env
    ? extractProcessLevelEnv(input.options.env)
    : null

  return createHash('sha256').update(stringify({
    apiKey: input.options.apiKey ?? null,
    chatgptAuth: input.chatgptAuth
      ? {
          credentialRef: input.chatgptAuth.credentialRef,
          accountId: input.chatgptAuth.chatgptAccountId,
          planType: input.chatgptAuth.chatgptPlanType,
        }
      : null,
    appServerPath: input.options.appServerPath ?? null,
    codexCliPath: input.options.codexCliPath ?? null,
    processLevelConfig,
    processLevelEnv,
    userAgentMode: input.options.userAgentMode ?? null,
    cliCompatibleIdentity: input.options.cliCompatibleIdentity ?? false,
  })!).digest('hex')
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
