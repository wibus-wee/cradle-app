import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RegisteredMcpServer } from '../../../../plugins/mcp-registry'
import { getRegisteredMcpServers } from '../../../../plugins/mcp-registry'
import type {
  ChatThinkingEffort,
  RuntimeSettings,
} from '../../../chat-runtime/runtime-provider-types'
import { readCodexLikeRuntimeSettings } from '../../../chat-runtime/runtime-settings'
import type { CodexAuthMode, CodexConfig } from '../../../provider-contracts/provider-base'
import type { CodexAppServerAuthResolution } from '../app-server/chatgpt-auth'
import {
  CODEX_BEDROCK_API_KEY_ENV,
  CODEX_BEDROCK_REGION_ENV,
  CODEX_PERSONAL_ACCESS_TOKEN_ENV,
} from '../app-server/chatgpt-auth'
import type { CollaborationMode } from '../app-server-protocol/CollaborationMode'
import type { ReasoningEffort } from '../app-server-protocol/ReasoningEffort'
import type { SandboxPolicy } from '../app-server-protocol/v2/SandboxPolicy'
import type { ThreadForkParams } from '../app-server-protocol/v2/ThreadForkParams'
import { toSandboxPolicy } from './sandbox-policy'

export const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
export const CODEX_AMAZON_BEDROCK_MODEL_PROVIDER = 'amazon-bedrock'
export const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'
export const CODEX_API_KEY_ENV = 'CODEX_API_KEY'
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
const CRADLE_CODEX_MCP_HEADER_ENV_PREFIX = 'CRADLE_CODEX_MCP_HEADER'

export function resolveCodexExternalModelProviderBaseUrl(
  config: CodexConfig,
): string | null {
  const baseUrl = config.baseUrl?.trim()
  return baseUrl || null
}

export function resolveCodexAuthMode(
  config: CodexConfig,
  auth: CodexAppServerAuthResolution,
): CodexAuthMode {
  switch (auth.kind) {
    case 'apiKey':
      return 'apikey'
    case 'chatgptAuthTokens':
      return 'chatgptAuthTokens'
    case 'personalAccessToken':
      return 'personalAccessToken'
    case 'bedrockApiKey':
      return 'bedrockApiKey'
    case 'none':
      return config.authMode ?? 'apikey'
  }
}

export function codexConfigRequiresApiKey(
  config: CodexConfig,
  auth: CodexAppServerAuthResolution,
): boolean {
  return resolveCodexExternalModelProviderBaseUrl(config) !== null
    && resolveCodexAuthMode(config, auth) === 'apikey'
    && !codexAuthHasApiKey(auth)
}

export function codexAuthHasApiKey(auth: CodexAppServerAuthResolution): boolean {
  return auth.kind === 'apiKey'
}

export function buildCodexExternalModelProviderConfig(
  baseUrl: string,
  authMode: CodexAuthMode,
): Record<string, unknown> {
  return {
    model_provider: CRADLE_CODEX_MODEL_PROVIDER,
    model_providers: {
      [CRADLE_CODEX_MODEL_PROVIDER]: {
        name: 'Cradle OpenAI Compatible',
        base_url: baseUrl,
        ...(authMode === 'apikey' ? { env_key: CRADLE_CODEX_API_KEY_ENV } : {}),
        wire_api: 'responses',
        requires_openai_auth: true,
      },
    },
  }
}

export function buildCodexBedrockModelProviderConfig(region: string): Record<string, unknown> {
  return {
    model_provider: CODEX_AMAZON_BEDROCK_MODEL_PROVIDER,
    model_providers: {
      [CODEX_AMAZON_BEDROCK_MODEL_PROVIDER]: {
        aws: {
          region,
        },
      },
    },
  }
}

export function buildCodexAuthEnvironment(auth: CodexAppServerAuthResolution): Record<string, string> {
  switch (auth.kind) {
    case 'apiKey':
      return {
        [CRADLE_CODEX_API_KEY_ENV]: auth.apiKey,
        [CODEX_API_KEY_ENV]: auth.apiKey,
        [OPENAI_API_KEY_ENV]: auth.apiKey,
      }
    case 'personalAccessToken':
      return { [CODEX_PERSONAL_ACCESS_TOKEN_ENV]: auth.personalAccessToken }
    case 'bedrockApiKey':
      return {
        [CODEX_BEDROCK_API_KEY_ENV]: auth.bedrockApiKey,
        [CODEX_BEDROCK_REGION_ENV]: auth.region,
      }
    case 'chatgptAuthTokens':
    case 'none':
      return {}
  }
}

export function resolveCodexSkillExtraRoots(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
): string[] {
  return config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
}

export function readCodexReasoningEffort(
  override: ChatThinkingEffort | undefined,
  configured: CodexConfig['reasoningEffort'],
): ReasoningEffort {
  switch (override) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return override
    default:
      return isCodexReasoningEffort(configured) ? configured : 'high'
  }
}

export function buildCodexConfig(
  config: CodexConfig,
  _workspacePath: string,
  _resolveSkillPaths: (workspacePath: string) => string[],
  systemPromptFile: string | null,
  effectiveModel: string | null | undefined,
  auth: CodexAppServerAuthResolution,
): NonNullable<ThreadForkParams['config']> {
  const codexConfig: NonNullable<ThreadForkParams['config']> = {
    network_access: 'enabled',
    show_raw_agent_reasoning: true,
    disable_response_storage: true,
  }
  const mcpServers = buildCodexMcpServersConfig()
  codexConfig.approval_policy = config.approvalPolicy
  codexConfig.sandbox_mode = config.sandboxMode
  if (Object.keys(mcpServers).length > 0) {
    codexConfig.mcp_servers = mcpServers
  }
  if (systemPromptFile) {
    codexConfig.instructions_paths = [systemPromptFile]
  }
  const authMode = resolveCodexAuthMode(config, auth)
  const externalBaseUrl = resolveCodexExternalModelProviderBaseUrl(config)
  if (externalBaseUrl) {
    Object.assign(codexConfig, buildCodexExternalModelProviderConfig(externalBaseUrl, authMode))
  }
  if (auth.kind === 'bedrockApiKey') {
    Object.assign(codexConfig, buildCodexBedrockModelProviderConfig(auth.region))
  }
  if (effectiveModel) {
    codexConfig.model = effectiveModel
  }
  return codexConfig
}

export function writeSystemPromptFile(systemPrompt: string | undefined): string | null {
  if (!systemPrompt) {
    return null
  }
  const filePath = join(tmpdir(), `cradle-codex-prompt-${randomUUID()}.md`)
  writeFileSync(filePath, systemPrompt, 'utf-8')
  return filePath
}

export function projectCodexRuntimeAccessMode(
  accessMode: 'approval-required' | 'full-access',
  input: {
    writableRoots: string[]
    additionalDirectories: string[]
  },
): {
  approvalPolicy: CodexConfig['approvalPolicy']
  sandbox: CodexConfig['sandboxMode']
  sandboxPolicy: SandboxPolicy
} {
  if (accessMode === 'approval-required') {
    return {
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      sandboxPolicy: toSandboxPolicy('read-only', input.writableRoots, input.additionalDirectories),
    }
  }
  return {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    sandboxPolicy: toSandboxPolicy('danger-full-access', input.writableRoots, input.additionalDirectories),
  }
}

export function buildCodexCollaborationMode(
  settings: RuntimeSettings,
  input: { model: string, effort: ReasoningEffort },
): CollaborationMode {
  const codexSettings = readCodexLikeRuntimeSettings(settings)
  return {
    mode: codexSettings.interactionMode,
    settings: {
      model: input.model,
      reasoning_effort: input.effort,
      developer_instructions: null,
    },
  }
}

export type CodexMcpServerConfig
  = | { command: string, args: string[], env?: Record<string, string> }
    | { url: string, env_http_headers?: Record<string, string> }

export function buildCodexMcpServersConfig(): Record<string, CodexMcpServerConfig> {
  return Object.fromEntries(
    Object.entries(getRegisteredMcpServers()).map(([name, config]) => [name, projectCodexMcpServer(name, config)]),
  )
}

export function buildCodexMcpServersEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [serverName, config] of Object.entries(getRegisteredMcpServers())) {
    if (config.transport !== 'streamable-http') {
      continue
    }
    for (const [headerName, headerValue] of Object.entries(config.headers)) {
      env[buildCodexMcpHeaderEnvName(serverName, headerName)] = headerValue
    }
  }
  return env
}

function projectCodexMcpServer(name: string, config: RegisteredMcpServer): CodexMcpServerConfig {
  if (config.transport === 'stdio') {
    const server: CodexMcpServerConfig = {
      command: config.command,
      args: config.args,
    }
    if (config.env && Object.keys(config.env).length > 0) {
      server.env = config.env
    }
    return server
  }

  const envHttpHeaders = Object.fromEntries(
    Object.keys(config.headers).map(headerName => [
      headerName,
      buildCodexMcpHeaderEnvName(name, headerName),
    ]),
  )
  return {
    url: config.url,
    ...(Object.keys(envHttpHeaders).length > 0 ? { env_http_headers: envHttpHeaders } : {}),
  }
}

function buildCodexMcpHeaderEnvName(serverName: string, headerName: string): string {
  return [
    CRADLE_CODEX_MCP_HEADER_ENV_PREFIX,
    normalizeEnvToken(serverName),
    normalizeEnvToken(headerName),
  ].join('_')
}

function normalizeEnvToken(value: string): string {
  const normalized = value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '')
  return normalized || 'VALUE'
}

function isCodexReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
}
