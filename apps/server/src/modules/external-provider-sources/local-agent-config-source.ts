import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  ExternalProviderRecord,
  ExternalProviderSource,
  ExternalProviderSourceReadContext,
  ExternalProviderSourceSnapshot,
  ExternalProviderWarning,
} from '@cradle/plugin-sdk/server'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

type JsonObject = Record<string, unknown>

const OptionalStringSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined
  }
  return value
}, z.string().trim().min(1).optional())

const ClaudeEnvSchema = z.object({
  ANTHROPIC_BASE_URL: OptionalStringSchema,
  ANTHROPIC_AUTH_TOKEN: OptionalStringSchema,
  ANTHROPIC_API_KEY: OptionalStringSchema,
  ANTHROPIC_MODEL: OptionalStringSchema,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: OptionalStringSchema,
  ANTHROPIC_DEFAULT_SONNET_MODEL: OptionalStringSchema,
  ANTHROPIC_DEFAULT_OPUS_MODEL: OptionalStringSchema,
}).catchall(z.unknown())

const ClaudeSettingsSchema = z.object({
  env: ClaudeEnvSchema.optional().default({}),
}).passthrough()

const CodexAuthSchema = z.object({
  OPENAI_API_KEY: OptionalStringSchema,
  apiKey: OptionalStringSchema,
  api_key: OptionalStringSchema,
}).catchall(z.unknown())

const CodexModelProviderSchema = z.object({
  base_url: OptionalStringSchema,
  wire_api: OptionalStringSchema,
}).passthrough()

const CodexTomlSchema = z.object({
  model_provider: OptionalStringSchema,
  model: OptionalStringSchema,
  model_reasoning_effort: OptionalStringSchema,
  approval_policy: OptionalStringSchema,
  sandbox_mode: OptionalStringSchema,
  openai_base_url: OptionalStringSchema,
  model_providers: z.record(z.string(), CodexModelProviderSchema).default({}),
}).passthrough()

const GeminiSettingsSchema = z.object({
  apiKey: OptionalStringSchema,
  api_key: OptionalStringSchema,
  model: OptionalStringSchema,
  endpoint: OptionalStringSchema,
  baseUrl: OptionalStringSchema,
  base_url: OptionalStringSchema,
  theme: OptionalStringSchema,
}).catchall(z.unknown())

const PiSettingsSchema = z.object({
  apiKey: OptionalStringSchema,
  api_key: OptionalStringSchema,
  model: OptionalStringSchema,
  endpoint: OptionalStringSchema,
  baseUrl: OptionalStringSchema,
  base_url: OptionalStringSchema,
}).catchall(z.unknown())

const KimiSettingsSchema = z.object({
  apiKey: OptionalStringSchema,
  api_key: OptionalStringSchema,
  model: OptionalStringSchema,
  endpoint: OptionalStringSchema,
  baseUrl: OptionalStringSchema,
  base_url: OptionalStringSchema,
}).catchall(z.unknown())

const ReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
const ApprovalPolicySchema = z.enum(['never', 'on-request', 'on-failure', 'untrusted'])
const SandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])

interface ClaudeConfigReadResult {
  settingsPath: string
  localSettingsPath: string
  settingsFound: boolean
  localSettingsFound: boolean
  env: z.infer<typeof ClaudeEnvSchema>
  warnings: ExternalProviderWarning[]
}

interface CodexConfigReadResult {
  configPath: string
  authPath: string
  configFound: boolean
  authFound: boolean
  config: z.infer<typeof CodexTomlSchema>
  auth: z.infer<typeof CodexAuthSchema>
  warnings: ExternalProviderWarning[]
}

export interface LocalAgentConfigSourceConfig {
  claudeDir: string
  claudeSettingsPath: string
  claudeLocalSettingsPath: string
  codexDir: string
  codexConfigPath: string
  codexAuthPath: string
  includeProcessEnv: boolean
}

interface ReadJsonResult<T> {
  found: boolean
  value: T | null
  warning: ExternalProviderWarning | null
}

const DEFAULT_SOURCE_ID = 'local-agent-config'
const DEFAULT_SOURCE_LABEL = 'Local Agent Config'

function hashText(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sourceConfigValue(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: string): string {
  return ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key] ?? fallback
}

function sourceConfigFlag(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: boolean): boolean {
  const value = ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key]
  if (value === undefined) {
    return fallback
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function resolveLocalAgentConfigSourceConfig(ctx: ExternalProviderSourceReadContext | null = null): LocalAgentConfigSourceConfig {
  const claudeDir = sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CLAUDE_DIR', join(homedir(), '.claude'))
  const codexDir = sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CODEX_DIR', join(homedir(), '.codex'))
  return {
    claudeDir,
    claudeSettingsPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', join(claudeDir, 'settings.json')),
    claudeLocalSettingsPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH', join(claudeDir, 'settings.local.json')),
    codexDir,
    codexConfigPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', join(codexDir, 'config.toml')),
    codexAuthPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', join(codexDir, 'auth.json')),
    includeProcessEnv: sourceConfigFlag(ctx, 'LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', true),
  }
}

function readJsonFile<T>(path: string, schema: z.ZodType<T>, warningCode: string, label: string): ReadJsonResult<T> {
  if (!existsSync(path)) {
    return { found: false, value: null, warning: null }
  }

  try {
    return {
      found: true,
      value: z.string()
        .transform(raw => JSON.parse(raw))
        .pipe(schema)
        .parse(readFileSync(path, 'utf8')),
      warning: null,
    }
  }
 catch (error) {
    return {
      found: true,
      value: null,
      warning: {
        code: warningCode,
        message: `${label} could not be parsed. ${errorMessage(error)}`,
        severity: 'warning',
      },
    }
  }
}

function readTomlFile<T>(path: string, schema: z.ZodType<T>, warningCode: string, label: string): ReadJsonResult<T> {
  if (!existsSync(path)) {
    return { found: false, value: null, warning: null }
  }

  try {
    return {
      found: true,
      value: schema.parse(parseToml(readFileSync(path, 'utf8'))),
      warning: null,
    }
  }
 catch (error) {
    return {
      found: true,
      value: null,
      warning: {
        code: warningCode,
        message: `${label} could not be parsed. ${errorMessage(error)}`,
        severity: 'warning',
      },
    }
  }
}

function readClaudeConfig(config: LocalAgentConfigSourceConfig): ClaudeConfigReadResult {
  const settings = readJsonFile(config.claudeSettingsPath, ClaudeSettingsSchema, 'local-claude-settings-invalid', 'Claude settings')
  const localSettings = readJsonFile(
    config.claudeLocalSettingsPath,
    ClaudeSettingsSchema,
    'local-claude-local-settings-invalid',
    'Claude local settings',
  )

  const processEnv = config.includeProcessEnv
    ? ClaudeEnvSchema.parse(process.env)
    : {}
  const env = ClaudeEnvSchema.parse({
    ...settings.value?.env,
    ...localSettings.value?.env,
    ...processEnv,
  })
  const warnings = [settings.warning, localSettings.warning].filter((warning): warning is ExternalProviderWarning => Boolean(warning))

  return {
    settingsPath: config.claudeSettingsPath,
    localSettingsPath: config.claudeLocalSettingsPath,
    settingsFound: settings.found,
    localSettingsFound: localSettings.found,
    env,
    warnings,
  }
}

function readCodexConfig(config: LocalAgentConfigSourceConfig): CodexConfigReadResult {
  const codexConfig = readTomlFile(config.codexConfigPath, CodexTomlSchema, 'local-codex-config-invalid', 'Codex config')
  const codexAuth = readJsonFile(config.codexAuthPath, CodexAuthSchema, 'local-codex-auth-invalid', 'Codex auth')
  const processAuth = config.includeProcessEnv
    ? CodexAuthSchema.parse(process.env)
    : {}
  const warnings = [codexConfig.warning, codexAuth.warning].filter((warning): warning is ExternalProviderWarning => Boolean(warning))

  return {
    configPath: config.codexConfigPath,
    authPath: config.codexAuthPath,
    configFound: codexConfig.found,
    authFound: codexAuth.found,
    config: CodexTomlSchema.parse(codexConfig.value ?? {}),
    auth: CodexAuthSchema.parse({
      ...codexAuth.value,
      ...processAuth,
    }),
    warnings,
  }
}

// --- PATH-based CLI tool detection ---

interface CliToolConfig {
  command: string
  aliases?: string[]
  app: 'claude' | 'codex' | 'gemini' | 'pi' | 'kimi'
  displayName: string
  settingsDirName: string
  settingsFileName: string
  settingsSchema: z.ZodType<JsonObject>
  envKeyVars: string[]
  envBaseUrlVars: string[]
  envModelVars: string[]
  iconSlug?: string
}

interface DetectedCliTool {
  tool: CliToolConfig
  executablePath: string
  settings: JsonObject | null
  settingsFound: boolean
  warnings: ExternalProviderWarning[]
}

const CLI_TOOLS: CliToolConfig[] = [
  {
    command: 'claude',
    app: 'claude',
    displayName: 'Claude CLI',
    settingsDirName: '.claude',
    settingsFileName: 'settings.json',
    settingsSchema: ClaudeSettingsSchema.transform(value => value.env),
    envKeyVars: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    envBaseUrlVars: ['ANTHROPIC_BASE_URL'],
    envModelVars: ['ANTHROPIC_MODEL'],
    iconSlug: 'claudecode',
  },
  {
    command: 'codex',
    app: 'codex',
    displayName: 'Codex CLI',
    settingsDirName: '.codex',
    settingsFileName: 'auth.json',
    settingsSchema: CodexAuthSchema,
    envKeyVars: ['OPENAI_API_KEY'],
    envBaseUrlVars: ['OPENAI_BASE_URL'],
    envModelVars: ['OPENAI_MODEL'],
    iconSlug: 'codex',
  },
  {
    command: 'gemini',
    app: 'gemini',
    displayName: 'Gemini',
    settingsDirName: '.gemini',
    settingsFileName: 'settings.json',
    settingsSchema: GeminiSettingsSchema,
    envKeyVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    envBaseUrlVars: ['GEMINI_BASE_URL', 'GOOGLE_BASE_URL'],
    envModelVars: ['GEMINI_MODEL'],
    iconSlug: 'geminicli',
  },
  {
    command: 'pi',
    app: 'pi',
    displayName: 'Pi',
    settingsDirName: '.pi',
    settingsFileName: 'config.json',
    settingsSchema: PiSettingsSchema,
    envKeyVars: ['PI_API_KEY'],
    envBaseUrlVars: ['PI_BASE_URL'],
    envModelVars: ['PI_MODEL'],
  },
  {
    command: 'kimi',
    aliases: ['kimi-cli', 'kimi-ci'],
    app: 'kimi',
    displayName: 'Kimi',
    settingsDirName: '.kimi',
    settingsFileName: 'config.json',
    settingsSchema: KimiSettingsSchema,
    envKeyVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    envBaseUrlVars: ['KIMI_BASE_URL', 'MOONSHOT_BASE_URL'],
    envModelVars: ['KIMI_MODEL', 'MOONSHOT_MODEL'],
    iconSlug: 'kimi',
  },
]

function cliToolSettingsFile(tool: CliToolConfig, config: LocalAgentConfigSourceConfig): string {
  if (tool.app === 'claude') {
    return config.claudeSettingsPath
  }
  if (tool.app === 'codex') {
    return config.codexAuthPath
  }
  return join(dirname(config.claudeDir), tool.settingsDirName, tool.settingsFileName)
}

const PATH_DELIMITER = process.platform === 'win32' ? ';' : ':'
const WIN_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.ps1', '.bat']

function detectCliExecutable(command: string): string | null {
  const pathEntries = process.env.PATH?.split(PATH_DELIMITER).filter(Boolean) ?? []
  const names = process.platform === 'win32'
    ? [command, ...WIN_EXECUTABLE_EXTENSIONS.map(ext => `${command}${ext}`)]
    : [command]
  for (const pathEntry of pathEntries) {
    for (const name of names) {
      const candidate = join(pathEntry, name)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      }
      catch {
        continue
      }
    }
  }
  return null
}

function detectFirstCliExecutable(commands: string[]): { command: string, executablePath: string } | null {
  for (const command of commands) {
    const executablePath = detectCliExecutable(command)
    if (executablePath) {
      return { command, executablePath }
    }
  }
  return null
}

function detectCliTools(config: LocalAgentConfigSourceConfig): DetectedCliTool[] {
  const results: DetectedCliTool[] = []
  for (const tool of CLI_TOOLS) {
    const detected = detectFirstCliExecutable([tool.command, ...(tool.aliases ?? [])])
    if (!detected) {
      continue
    }

    const settingsResult = readJsonFile(cliToolSettingsFile(tool, config), tool.settingsSchema, `local-${tool.command}-settings-invalid`, `${tool.command} settings`)
    const settings = settingsResult.found ? (settingsResult.value as JsonObject ?? {}) : {}
    const warnings = settingsResult.warning ? [settingsResult.warning] : []

    results.push({
      tool,
      executablePath: detected.executablePath,
      settings: settingsResult.found ? settings : null,
      settingsFound: settingsResult.found,
      warnings,
    })
  }
  return results
}

function firstEnvValue(keys: string[], includeProcessEnv: boolean): string | undefined {
  if (!includeProcessEnv) {
    return undefined
  }
  return keys
    .map(key => process.env[key])
    .find(val => val && val.trim().length > 0)
}

function cliToolRecord(detected: DetectedCliTool, includeProcessEnv: boolean): ExternalProviderRecord | null {
  const envApiKey = firstEnvValue(detected.tool.envKeyVars, includeProcessEnv)

  const settingsApiKey = detected.settings
    ? ((detected.settings.apiKey as string | undefined) ?? (detected.settings.api_key as string | undefined))
    : undefined
  const apiKey = settingsApiKey ?? envApiKey

  const envBaseUrl = firstEnvValue(detected.tool.envBaseUrlVars, includeProcessEnv)

  const settingsModel = detected.settings
    ? (detected.settings.model as string | undefined)
    : undefined
  const envModel = firstEnvValue(detected.tool.envModelVars, includeProcessEnv)
  const model = settingsModel ?? envModel

  const settingsEndpoint = detected.settings
    ? (
        (detected.settings.endpoint as string | undefined)
        ?? (detected.settings.baseUrl as string | undefined)
        ?? (detected.settings.base_url as string | undefined)
      )
    : undefined
  const baseUrl = settingsEndpoint ?? envBaseUrl

  const hasSignal = detected.settingsFound || Boolean(apiKey) || Boolean(baseUrl) || Boolean(model) || Boolean(detected.executablePath)
  if (!hasSignal) {
    return null
  }

  return {
    externalId: `${detected.tool.command}:local-command`,
    app: detected.tool.app,
    name: `Local ${detected.tool.displayName}`,
    providerKind: 'cli-tool',
    config: compactRecord({
      executable: detected.executablePath,
      baseUrl,
      model,
    }),
    credential: apiKey ? { kind: 'api-key', value: apiKey, label: `Local ${detected.tool.displayName}` } : undefined,
    current: true,
    metadata: compactRecord({
      executable: detected.executablePath,
      baseUrl,
      model,
      apiFormat: 'cli-tool',
      iconSlug: detected.tool.iconSlug,
      runtimeKind: 'cli-tui',
      rawFingerprintHint: hashText({
        executable: detected.executablePath,
        settingsFound: detected.settingsFound,
        baseUrl,
        model,
        hasCredential: Boolean(apiKey),
      }),
    }),
    warnings: apiKey
      ? []
      : [{
          code: `local-${detected.tool.command}-credential-missing`,
          message: `No ${detected.tool.command} API key was found in local config or environment.`,
          severity: 'info' as const,
        }],
  }
}

function compactRecord(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function maybeEnum<T extends z.ZodEnum>(schema: T, value: string | undefined): z.infer<T> | undefined {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function claudeRecord(input: ClaudeConfigReadResult): ExternalProviderRecord | null {
  const apiKey = input.env.ANTHROPIC_AUTH_TOKEN ?? input.env.ANTHROPIC_API_KEY
  const authMode = !apiKey && (input.settingsFound || input.localSettingsFound) ? 'claudeAi' : undefined
  const modelAliases = compactRecord({
    haiku: input.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    sonnet: input.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    opus: input.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  })
  const hasAlias = Object.keys(modelAliases).length > 0
  const hasSignal = input.settingsFound
    || input.localSettingsFound
    || Boolean(input.env.ANTHROPIC_BASE_URL)
    || Boolean(input.env.ANTHROPIC_MODEL)
    || Boolean(apiKey)
    || hasAlias

  if (!hasSignal) {
    return null
  }

  return {
    externalId: 'claude:local-current',
    app: 'claude',
    name: 'Local Claude',
    providerKind: 'anthropic',
    config: compactRecord({
      authMode,
      baseUrl: input.env.ANTHROPIC_BASE_URL,
      model: input.env.ANTHROPIC_MODEL,
      claudeAgent: hasAlias ? { modelAliases } : undefined,
    }),
    credential: apiKey ? { kind: 'api-key', value: apiKey, label: 'Local Claude' } : undefined,
    current: true,
    metadata: compactRecord({
      baseUrl: input.env.ANTHROPIC_BASE_URL,
      model: input.env.ANTHROPIC_MODEL,
      apiFormat: 'anthropic',
      authMode,
      iconSlug: 'claude',
      rawFingerprintHint: hashText({
        settingsFound: input.settingsFound,
        localSettingsFound: input.localSettingsFound,
        baseUrl: input.env.ANTHROPIC_BASE_URL,
        model: input.env.ANTHROPIC_MODEL,
        modelAliases,
        hasCredential: Boolean(apiKey),
      }),
    }),
    warnings: apiKey
      ? []
      : [{
          code: 'local-claude-credential-missing',
          message: 'No Claude API key was found in the allowlisted local config or process environment.',
          severity: 'info',
        }],
  }
}

function codexRecord(input: CodexConfigReadResult): ExternalProviderRecord | null {
  const providerId = input.config.model_provider
  const activeProvider = providerId ? input.config.model_providers[providerId] : undefined
  const baseUrl = activeProvider?.base_url ?? input.config.openai_base_url
  const wireApi = activeProvider?.wire_api
  const apiMode = wireApi === 'chat'
    ? 'chat-completions'
    : wireApi === 'responses'
      ? 'responses'
      : undefined
  const apiKey = input.auth.OPENAI_API_KEY ?? input.auth.apiKey ?? input.auth.api_key
  const hasSignal = input.configFound
    || input.authFound
    || Boolean(input.config.model)
    || Boolean(baseUrl)
    || Boolean(apiKey)

  if (!hasSignal) {
    return null
  }

  return {
    externalId: 'codex:local-current',
    app: 'codex',
    name: 'Local Codex',
    providerKind: 'openai-compatible',
    config: compactRecord({
      baseUrl,
      model: input.config.model,
      apiMode,
      reasoningEffort: maybeEnum(ReasoningEffortSchema, input.config.model_reasoning_effort),
      approvalPolicy: maybeEnum(ApprovalPolicySchema, input.config.approval_policy),
      sandboxMode: maybeEnum(SandboxModeSchema, input.config.sandbox_mode),
    }),
    credential: apiKey ? { kind: 'api-key', value: apiKey, label: 'Local Codex' } : undefined,
    current: true,
    metadata: compactRecord({
      baseUrl,
      model: input.config.model,
      apiFormat: wireApi ? `openai_${wireApi}` : 'openai',
      rawFingerprintHint: hashText({
        configFound: input.configFound,
        authFound: input.authFound,
        modelProvider: providerId,
        baseUrl,
        wireApi,
        model: input.config.model,
        reasoningEffort: input.config.model_reasoning_effort,
        approvalPolicy: input.config.approval_policy,
        sandboxMode: input.config.sandbox_mode,
        hasCredential: Boolean(apiKey),
      }),
    }),
    warnings: apiKey
      ? []
      : [{
          code: 'local-codex-credential-missing',
          message: 'No Codex API key was found in the allowlisted local config or process environment.',
          severity: 'info',
        }],
  }
}

export function readLocalAgentConfigExternalProviderSnapshot(
  config: LocalAgentConfigSourceConfig,
): ExternalProviderSourceSnapshot {
  const claude = readClaudeConfig(config)
  const codex = readCodexConfig(config)
  const cliTools = detectCliTools(config)
  const cliRecords = cliTools
    .map(detected => cliToolRecord(detected, config.includeProcessEnv))
    .filter((record): record is ExternalProviderRecord => Boolean(record))

  const providers = [
    claudeRecord(claude),
    codexRecord(codex),
    ...cliRecords,
  ]
    .filter((record): record is ExternalProviderRecord => Boolean(record))
  const warnings = [
    ...claude.warnings,
    ...codex.warnings,
    ...cliTools.flatMap(t => t.warnings),
  ]

  return {
    source: {
      status: warnings.some(warning => warning.severity === 'error')
        ? 'error'
        : warnings.length > 0
          ? 'warning'
          : 'ok',
      message: providers.length > 0
        ? `Detected ${providers.length} local agent config ${providers.length === 1 ? 'record' : 'records'}.`
        : 'No local agent config records were detected.',
      observedAt: new Date().toISOString(),
    },
    providers,
    inventory: {},
    warnings,
  }
}

export async function readLocalAgentConfigExternalProviderSnapshotFromContext(
  ctx: ExternalProviderSourceReadContext,
): Promise<ExternalProviderSourceSnapshot> {
  return readLocalAgentConfigExternalProviderSnapshot(resolveLocalAgentConfigSourceConfig(ctx))
}

export function createLocalAgentConfigExternalProviderSource(): ExternalProviderSource {
  return {
    id: DEFAULT_SOURCE_ID,
    label: DEFAULT_SOURCE_LABEL,
    description: 'Reads local agent configuration and detects CLI tools on PATH for onboarding.',
    capabilities: { refresh: true },
    readSnapshot: readLocalAgentConfigExternalProviderSnapshotFromContext,
  }
}
