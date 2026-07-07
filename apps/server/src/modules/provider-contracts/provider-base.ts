import { z } from 'zod'

export const CODEX_DEFAULT_APPROVAL_POLICY = 'never'
export const CODEX_DEFAULT_SANDBOX_MODE = 'danger-full-access'

export const CodexAuthModeSchema = z.enum([
  'apikey',
  'chatgpt',
  'chatgptAuthTokens',
  'agentIdentity',
  'personalAccessToken',
  'bedrockApiKey',
])

export const AnthropicAuthModeSchema = z.enum(['apiKey', 'claudeAi'])

export const ClaudeAgentAuthModeSchema = AnthropicAuthModeSchema

export const BaseProviderConfig = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  enabledModels: z.array(z.string()).default([]),
  skillPaths: z.array(z.string()).default([]),
  additionalDirectories: z.array(z.string()).default([]),
})

export const OpenAICompatibleConfigSchema = BaseProviderConfig.pick({
  baseUrl: true,
  model: true,
  enabledModels: true,
}).extend({
  authMode: CodexAuthModeSchema.optional(),
  baseUrl: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  maxMessages: z.number().default(50),
  /** 'responses' uses OpenAI Responses API; 'chat-completions' uses legacy Chat Completions API. */
  apiMode: z.enum(['responses', 'chat-completions']).optional(),
})

export const AnthropicConfigSchema = BaseProviderConfig.pick({
  baseUrl: true,
  model: true,
  enabledModels: true,
}).extend({
  authMode: AnthropicAuthModeSchema.default('apiKey'),
  baseUrl: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  maxMessages: z.number().default(50),
})

export const CodexConfigSchema = BaseProviderConfig.extend({
  authMode: CodexAuthModeSchema.optional(),
  approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).default(CODEX_DEFAULT_APPROVAL_POLICY),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default(CODEX_DEFAULT_SANDBOX_MODE),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).default('high'),
  bedrock: z.object({
    region: z.string().trim().min(1),
  }).optional(),
})

const ClaudeAgentModelEnvValueSchema = z.string().trim()

export const ClaudeAgentConfigSchema = BaseProviderConfig.extend({
  authMode: ClaudeAgentAuthModeSchema.default('apiKey'),
  claudeAgent: z.object({
    modelAliases: z.object({
      haiku: ClaudeAgentModelEnvValueSchema.optional(),
      sonnet: ClaudeAgentModelEnvValueSchema.optional(),
      opus: ClaudeAgentModelEnvValueSchema.optional(),
    }).optional(),
    subagentModel: ClaudeAgentModelEnvValueSchema.optional(),
  }).optional(),
  permissionMode: z.enum(['bypassPermissions', 'plan']).default('bypassPermissions'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  allowDangerouslySkipPermissions: z.boolean().optional(),
  skills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  maxTurns: z.number().default(100),
})

export const UniversalProviderConfigSchema = z.object({
  baseUrl: z.string().nullable().default(null),
  openaiBaseUrl: z.string().nullable().default(null),
  anthropicBaseUrl: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  enabledModels: z.array(z.string()).default([]),
  maxMessages: z.number().default(50),
})

export const UniversalProviderConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(UniversalProviderConfigSchema)

export type UniversalProviderConfig = z.infer<typeof UniversalProviderConfigSchema>
export type AnthropicAuthMode = z.infer<typeof AnthropicAuthModeSchema>
export type CodexAuthMode = z.infer<typeof CodexAuthModeSchema>
export type ClaudeAgentAuthMode = z.infer<typeof ClaudeAgentAuthModeSchema>

export function readTrustedUniversalConfig(raw: string): UniversalProviderConfig {
  const config = JSON.parse(raw) as Partial<UniversalProviderConfig>
  const legacyBaseUrl = config.baseUrl ?? null
  return {
    baseUrl: legacyBaseUrl,
    openaiBaseUrl: config.openaiBaseUrl ?? legacyBaseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl ?? legacyBaseUrl,
    model: config.model ?? null,
    enabledModels: config.enabledModels ?? [],
    maxMessages: config.maxMessages ?? 50,
  }
}

export const SystemAgentConfigSchema = z.object({
  /** Upstream provider for jar-core, for example "openai", "anthropic", or "google". */
  provider: z.string().nullable().default(null),
  /** Model ID to use. */
  model: z.string().nullable().default(null),
  /** Base URL override for the upstream provider. */
  baseUrl: z.string().nullable().default(null),
  /** API key, inline or resolved from secretRef/credentialRef. */
  apiKey: z.string().nullable().default(null),
  /** API protocol type, for example "openai-completions" or "anthropic-messages". */
  api: z.string().nullable().default(null),
  /** Custom HTTP headers to pass to the upstream provider. */
  headers: z.record(z.string(), z.string()).default({}),
  /** Provider-specific compatibility options. */
  compat: z.record(z.string(), z.unknown()).default({}),
  /** Thinking level: how much reasoning budget to give. */
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('medium'),
  /** Max turns before the agent stops. */
  maxTurns: z.number().default(20),
})

export const OpenAICompatibleConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(OpenAICompatibleConfigSchema)

export const AnthropicConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(AnthropicConfigSchema)

export const CodexConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(CodexConfigSchema)

export const ClaudeAgentConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ClaudeAgentConfigSchema)

export const SystemAgentConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(SystemAgentConfigSchema)

export type BaseProviderConfigInput = z.infer<typeof BaseProviderConfig>
export type OpenAICompatibleConfig = z.infer<typeof OpenAICompatibleConfigSchema>
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>
export type CodexConfig = z.infer<typeof CodexConfigSchema>
export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>
export type SystemAgentConfig = z.infer<typeof SystemAgentConfigSchema>

export interface ProviderDeps {
  readSecret: (secretRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

export interface SecretRefCarrier {
  credentialRef?: string | null
  secretRef?: string | null
}

function readTrustedRecord(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>
}

export function readTrustedOpenAICompatibleConfig(raw: string): OpenAICompatibleConfig {
  const config = readTrustedRecord(raw) as Partial<OpenAICompatibleConfig>
  return {
    baseUrl: config.baseUrl ?? null,
    model: config.model ?? null,
    authMode: config.authMode,
    enabledModels: config.enabledModels ?? [],
    maxMessages: config.maxMessages ?? 50,
    apiMode: config.apiMode,
  }
}

export function readTrustedAnthropicConfig(raw: string): AnthropicConfig {
  const config = readTrustedRecord(raw) as Partial<AnthropicConfig>
  return {
    baseUrl: config.baseUrl ?? null,
    model: config.model ?? null,
    authMode: config.authMode ?? 'apiKey',
    enabledModels: config.enabledModels ?? [],
    maxMessages: config.maxMessages ?? 50,
  }
}

export function readTrustedCodexConfig(raw: string): CodexConfig {
  const config = readTrustedRecord(raw) as Partial<CodexConfig>
  const bedrock = config.bedrock && typeof config.bedrock.region === 'string' && config.bedrock.region.trim()
    ? { region: config.bedrock.region.trim() }
    : undefined
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    authMode: config.authMode,
    bedrock,
    enabledModels: config.enabledModels ?? [],
    skillPaths: config.skillPaths ?? [],
    additionalDirectories: config.additionalDirectories ?? [],
    approvalPolicy: config.approvalPolicy ?? CODEX_DEFAULT_APPROVAL_POLICY,
    sandboxMode: config.sandboxMode ?? CODEX_DEFAULT_SANDBOX_MODE,
    reasoningEffort: config.reasoningEffort ?? 'high',
  }
}

export function readTrustedClaudeAgentConfig(raw: string): ClaudeAgentConfig {
  const config = readTrustedRecord(raw) as Partial<ClaudeAgentConfig>
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    authMode: config.authMode ?? 'apiKey',
    enabledModels: config.enabledModels ?? [],
    skillPaths: config.skillPaths ?? [],
    additionalDirectories: config.additionalDirectories ?? [],
    claudeAgent: config.claudeAgent,
    permissionMode: config.permissionMode === 'plan' ? 'plan' : 'bypassPermissions',
    effort: config.effort ?? 'high',
    allowDangerouslySkipPermissions: config.allowDangerouslySkipPermissions,
    skills: config.skills ?? [],
    tools: config.tools,
    disallowedTools: config.disallowedTools,
    maxTurns: config.maxTurns ?? 100,
  }
}

export function readTrustedSystemAgentConfig(raw: string): SystemAgentConfig {
  const config = readTrustedRecord(raw) as Partial<SystemAgentConfig>
  return {
    provider: config.provider ?? null,
    model: config.model ?? null,
    baseUrl: config.baseUrl ?? null,
    apiKey: config.apiKey ?? null,
    api: config.api ?? null,
    headers: config.headers ?? {},
    compat: config.compat ?? {},
    thinkingLevel: config.thinkingLevel ?? 'medium',
    maxTurns: config.maxTurns ?? 20,
  }
}

export function resolveApiKey(
  rawInput: SecretRefCarrier,
  configApiKey: string | undefined,
  envVar: string,
  deps: ProviderDeps,
): string | null {
  const secretRef = rawInput.secretRef ?? rawInput.credentialRef ?? null
  if (secretRef) {
    return deps.readSecret(secretRef)
  }
  if (configApiKey) {
    return configApiKey
  }
  return process.env[envVar] ?? null
}

const TRAILING_SLASH_RE = /\/+$/

export function normalizeBaseUrl(url: string): string {
  return url.replace(TRAILING_SLASH_RE, '')
}
