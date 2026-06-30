/* Reads CC Switch local provider data and maps it into Cradle external provider snapshots. */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  ExternalProviderCredential,
  ExternalProviderRecord,
  ExternalProviderSource,
  ExternalProviderSourceReadContext,
  ExternalProviderSourceSnapshot,
  ExternalProviderWarning,
} from '@cradle/plugin-sdk/server'
import Database from 'better-sqlite3'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

type JsonObject = Record<string, unknown>

const NonEmptyStringSchema = z.string().trim().min(1)
const OptionalExternalStringSchema = z.preprocess((value) => {
  if (value === null) { return undefined }
  if (typeof value === 'string' && value.trim().length === 0) { return undefined }
  return value
}, NonEmptyStringSchema.optional())
const NullableStringSchema = NonEmptyStringSchema.nullable().optional().default(null)
const NullableNumberSchema = z.number().finite().nullable().optional().default(null)
const SqlBooleanSchema = z.union([z.boolean(), z.literal(0), z.literal(1)])
  .transform(value => value === true || value === 1)

const ProviderEnvFieldsSchema = z.object({
  ANTHROPIC_BASE_URL: OptionalExternalStringSchema,
  ANTHROPIC_MODEL: OptionalExternalStringSchema,
  ANTHROPIC_DEFAULT_SONNET_MODEL: OptionalExternalStringSchema,
  ANTHROPIC_DEFAULT_OPUS_MODEL: OptionalExternalStringSchema,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: OptionalExternalStringSchema,
  ANTHROPIC_AUTH_TOKEN: OptionalExternalStringSchema,
  ANTHROPIC_API_KEY: OptionalExternalStringSchema,
  GOOGLE_GEMINI_BASE_URL: OptionalExternalStringSchema,
  GEMINI_MODEL: OptionalExternalStringSchema,
  GEMINI_API_KEY: OptionalExternalStringSchema,
}).catchall(z.unknown())

const ProviderEnvSchema = z.preprocess(value => value === null ? undefined : value, ProviderEnvFieldsSchema.optional().default({}))

const ProviderAuthFieldsSchema = z.object({
  OPENAI_API_KEY: OptionalExternalStringSchema,
  auth_mode: OptionalExternalStringSchema,
  access_token: OptionalExternalStringSchema,
  refresh_token: OptionalExternalStringSchema,
  id_token: OptionalExternalStringSchema,
  account_id: OptionalExternalStringSchema,
  chatgpt_account_id: OptionalExternalStringSchema,
  chatgptAccountId: OptionalExternalStringSchema,
  chatgpt_plan_type: OptionalExternalStringSchema,
  chatgptPlanType: OptionalExternalStringSchema,
  tokens: z.object({
    access_token: OptionalExternalStringSchema,
    refresh_token: OptionalExternalStringSchema,
    id_token: OptionalExternalStringSchema,
    account_id: OptionalExternalStringSchema,
  }).catchall(z.unknown()).optional(),
}).catchall(z.unknown())

const ProviderAuthSchema = z.preprocess(value => value === null ? undefined : value, ProviderAuthFieldsSchema.optional().default({}))

const ProviderSettingsConfigSchema = z.object({
  env: ProviderEnvSchema,
  auth: ProviderAuthSchema,
  config: z.unknown().optional(),
}).passthrough()

const ProviderMetaSchema = z.object({
  apiFormat: OptionalExternalStringSchema,
}).passthrough()

const ProviderSettingsConfigTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ProviderSettingsConfigSchema)

const ProviderMetaTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ProviderMetaSchema)

const ProviderEndpointRowSchema = z.object({
  provider_id: z.string(),
  app_type: z.string(),
  url: z.string(),
  added_at: NullableNumberSchema,
})

const ProviderHealthRowSchema = z.object({
  provider_id: z.string(),
  app_type: z.string(),
  is_healthy: SqlBooleanSchema,
})

const ProviderDbRowSchema = z.object({
  id: z.string(),
  app_type: z.string(),
  name: z.string(),
  settings_config: z.string(),
  website_url: NullableStringSchema,
  category: NullableStringSchema,
  created_at: NullableNumberSchema,
  sort_index: NullableNumberSchema,
  notes: NullableStringSchema,
  icon: NullableStringSchema,
  icon_color: NullableStringSchema,
  meta: z.string(),
  is_current: SqlBooleanSchema,
  in_failover_queue: SqlBooleanSchema,
})

const CodexTomlModelProviderSchema = z.object({
  base_url: OptionalExternalStringSchema,
  wire_api: OptionalExternalStringSchema,
}).passthrough()

const CodexTomlConfigSchema = z.object({
  model_provider: OptionalExternalStringSchema,
  model: OptionalExternalStringSchema,
  model_reasoning_effort: OptionalExternalStringSchema,
  approval_policy: OptionalExternalStringSchema,
  sandbox_mode: OptionalExternalStringSchema,
  model_providers: z.record(z.string(), CodexTomlModelProviderSchema).default({}),
}).passthrough()

interface CcSwitchSourceConfig {
  appConfigDir: string
  dbPath: string
  settingsPath: string
}

interface CcSwitchProviderRow {
  id: string
  appType: string
  name: string
  settingsConfig: z.infer<typeof ProviderSettingsConfigSchema>
  settingsConfigRaw: string
  websiteUrl: string | null
  category: string | null
  createdAt: number | null
  sortIndex: number | null
  notes: string | null
  icon: string | null
  iconColor: string | null
  meta: z.infer<typeof ProviderMetaSchema>
  metaRaw: string
  isCurrent: boolean
  inFailoverQueue: boolean
  endpoints: Array<{ url: string, addedAt: number | null }>
  health: 'healthy' | 'unhealthy' | 'unknown'
}

interface CcSwitchSnapshotReadResult {
  providers: CcSwitchProviderRow[]
  inventory: {
    mcpServers?: number
    prompts?: number
    skills?: number
    usageRollups?: number
    modelPricingEntries?: number
  }
  warnings: ExternalProviderWarning[]
}

const LocalSettingsSchema = z.object({
  currentProviderClaude: OptionalExternalStringSchema,
  currentProviderClaudeDesktop: OptionalExternalStringSchema,
  currentProviderCodex: OptionalExternalStringSchema,
  currentProviderGemini: OptionalExternalStringSchema,
  currentProviderOpenCode: OptionalExternalStringSchema,
  currentProviderOpenClaw: OptionalExternalStringSchema,
  currentProviderHermes: OptionalExternalStringSchema,
})

type LocalSettings = z.infer<typeof LocalSettingsSchema>

const CURRENT_PROVIDER_KEYS: Record<string, keyof LocalSettings> = {
  'claude': 'currentProviderClaude',
  'claude-desktop': 'currentProviderClaudeDesktop',
  'codex': 'currentProviderCodex',
  'gemini': 'currentProviderGemini',
  'opencode': 'currentProviderOpenCode',
  'openclaw': 'currentProviderOpenClaw',
  'hermes': 'currentProviderHermes',
}

const SUPPORTED_APPS = new Set(['claude', 'codex', 'gemini'])
const ICON_SLUG_ALIASES: Record<string, string> = {
  huoshan: 'volcengine',
}

function textHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function warningMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compactJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function optionalExternalString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isAbsoluteIconUrl(value: string | undefined): boolean {
  if (!value) { return false }
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:'
  }
  catch {
    return false
  }
}

function providerIconUrl(provider: CcSwitchProviderRow): string | undefined {
  const icon = optionalExternalString(provider.icon)
  return isAbsoluteIconUrl(icon) ? icon : undefined
}

function providerIconSlugFromIcon(provider: CcSwitchProviderRow): string | undefined {
  const icon = optionalExternalString(provider.icon)
  if (!icon || isAbsoluteIconUrl(icon)) { return undefined }
  return ICON_SLUG_ALIASES[icon] ?? icon
}

function compactInventory(inventory: CcSwitchSnapshotReadResult['inventory']): CcSwitchSnapshotReadResult['inventory'] {
  return Object.fromEntries(Object.entries(inventory).filter(([, entry]) => entry !== undefined)) as CcSwitchSnapshotReadResult['inventory']
}

function providerLabel(row: z.infer<typeof ProviderDbRowSchema> | null, index: number): string {
  if (!row) { return `row ${index + 1}` }
  return `${row.app_type}/${row.id} (${row.name})`
}

function readLocalSettings(path: string): { settings: LocalSettings, warnings: ExternalProviderWarning[] } {
  if (!existsSync(path)) { return { settings: {}, warnings: [] } }
  try {
    return {
      settings: z.string()
        .transform(raw => JSON.parse(raw))
        .pipe(LocalSettingsSchema)
        .parse(readFileSync(path, 'utf8')),
      warnings: [],
    }
  }
  catch (error) {
    return {
      settings: {},
      warnings: [{
        code: 'cc-switch-settings-invalid',
        message: `CC Switch local settings could not be parsed; database current flags were used instead. ${warningMessage(error)}`,
        severity: 'warning',
      }],
    }
  }
}

function configValue(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: string): string {
  return ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key] ?? fallback
}

export function resolveCcSwitchSourceConfig(ctx: ExternalProviderSourceReadContext | null = null): CcSwitchSourceConfig {
  const defaultDir = join(homedir(), '.cc-switch')
  const appConfigDir = configValue(ctx, 'CC_SWITCH_APP_CONFIG_DIR', defaultDir)
  return {
    appConfigDir,
    dbPath: configValue(ctx, 'CC_SWITCH_DB_PATH', join(appConfigDir, 'cc-switch.db')),
    settingsPath: configValue(ctx, 'CC_SWITCH_SETTINGS_PATH', join(appConfigDir, 'settings.json')),
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare('SELECT 1 AS exists_flag FROM sqlite_master WHERE type = \'table\' AND name = ? LIMIT 1').get(tableName)
  return Boolean(row)
}

function tableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

function columnSelect(columns: Set<string>, name: string, fallback: string): string {
  return columns.has(name) ? name : `${fallback} AS ${name}`
}

function countRows(db: Database.Database, tableName: string): number | undefined {
  if (!tableExists(db, tableName)) { return undefined }
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
  return row.count
}

function readEndpoints(db: Database.Database): Map<string, Array<{ url: string, addedAt: number | null }>> {
  if (!tableExists(db, 'provider_endpoints')) { return new Map() }
  const rows = db.prepare('SELECT provider_id, app_type, url, added_at FROM provider_endpoints ORDER BY added_at ASC, url ASC').all() as Array<{
    provider_id: string
    app_type: string
    url: string
    added_at: number | null
  }>
  const endpoints = new Map<string, Array<{ url: string, addedAt: number | null }>>()
  for (const row of z.array(ProviderEndpointRowSchema).parse(rows)) {
    const key = `${row.app_type}\0${row.provider_id}`
    const current = endpoints.get(key) ?? []
    current.push({ url: row.url, addedAt: row.added_at })
    endpoints.set(key, current)
  }
  return endpoints
}

function readHealth(db: Database.Database): Map<string, 'healthy' | 'unhealthy' | 'unknown'> {
  if (!tableExists(db, 'provider_health')) { return new Map() }
  const rows = db.prepare('SELECT provider_id, app_type, is_healthy FROM provider_health').all() as Array<{
    provider_id: string
    app_type: string
    is_healthy: number
  }>
  return new Map(z.array(ProviderHealthRowSchema).parse(rows).map(row => [`${row.app_type}\0${row.provider_id}`, row.is_healthy ? 'healthy' : 'unhealthy']))
}

function effectiveCurrentIds(providers: CcSwitchProviderRow[], localSettings: LocalSettings): Map<string, string | null> {
  const byApp = new Map<string, Set<string>>()
  for (const provider of providers) {
    const ids = byApp.get(provider.appType) ?? new Set<string>()
    ids.add(provider.id)
    byApp.set(provider.appType, ids)
  }

  const currentIds = new Map<string, string | null>()
  for (const appType of byApp.keys()) {
    const settingsKey = CURRENT_PROVIDER_KEYS[appType]
    const localCurrent = settingsKey ? localSettings[settingsKey] : undefined
    if (localCurrent && byApp.get(appType)?.has(localCurrent)) {
      currentIds.set(appType, localCurrent)
      continue
    }
    currentIds.set(appType, providers.find(provider => provider.appType === appType && provider.isCurrent)?.id ?? null)
  }
  return currentIds
}

function readProviderRows(db: Database.Database, settingsPath: string): { providers: CcSwitchProviderRow[], warnings: ExternalProviderWarning[] } {
  if (!tableExists(db, 'providers')) {
    throw new Error('CC Switch database is missing providers table')
  }

  const columns = tableColumns(db, 'providers')
  for (const requiredColumn of ['id', 'app_type', 'name', 'settings_config']) {
    if (!columns.has(requiredColumn)) {
      throw new Error(`CC Switch providers table is missing required column ${requiredColumn}`)
    }
  }

  const endpoints = readEndpoints(db)
  const health = readHealth(db)
  const rows = db.prepare(`
    SELECT
      id,
      app_type,
      name,
      settings_config,
      ${columnSelect(columns, 'website_url', 'NULL')},
      ${columnSelect(columns, 'category', 'NULL')},
      ${columnSelect(columns, 'created_at', 'NULL')},
      ${columnSelect(columns, 'sort_index', 'NULL')},
      ${columnSelect(columns, 'notes', 'NULL')},
      ${columnSelect(columns, 'icon', 'NULL')},
      ${columnSelect(columns, 'icon_color', 'NULL')},
      ${columnSelect(columns, 'meta', '\'{}\'')},
      ${columnSelect(columns, 'is_current', '0')},
      ${columnSelect(columns, 'in_failover_queue', '0')}
    FROM providers
    ORDER BY app_type ASC, COALESCE(sort_index, 999999), created_at ASC, id ASC
  `).all()

  const providers: CcSwitchProviderRow[] = []
  const warnings: ExternalProviderWarning[] = []
  for (const [index, rawRow] of rows.entries()) {
    const row = ProviderDbRowSchema.safeParse(rawRow)
    if (!row.success) {
      warnings.push({
        code: 'cc-switch-provider-row-invalid',
        message: `Skipped CC Switch provider row ${index + 1} because its database columns are invalid. ${warningMessage(row.error)}`,
        severity: 'warning',
      })
      continue
    }

    const settingsConfig = ProviderSettingsConfigTextSchema.safeParse(row.data.settings_config)
    if (!settingsConfig.success) {
      warnings.push({
        code: 'cc-switch-provider-settings-invalid',
        message: `Skipped CC Switch provider ${providerLabel(row.data, index)} because settings_config could not be parsed. ${warningMessage(settingsConfig.error)}`,
        severity: 'warning',
      })
      continue
    }

    const meta = ProviderMetaTextSchema.safeParse(row.data.meta)
    if (!meta.success) {
      warnings.push({
        code: 'cc-switch-provider-meta-invalid',
        message: `Used empty metadata for CC Switch provider ${providerLabel(row.data, index)} because meta could not be parsed. ${warningMessage(meta.error)}`,
        severity: 'warning',
      })
    }

    providers.push({
      id: row.data.id,
      appType: row.data.app_type,
      name: row.data.name,
      settingsConfig: settingsConfig.data,
      settingsConfigRaw: row.data.settings_config,
      websiteUrl: row.data.website_url,
      category: row.data.category,
      createdAt: row.data.created_at,
      sortIndex: row.data.sort_index,
      notes: row.data.notes,
      icon: row.data.icon,
      iconColor: row.data.icon_color,
      meta: meta.success ? meta.data : {},
      metaRaw: row.data.meta,
      isCurrent: row.data.is_current,
      inFailoverQueue: row.data.in_failover_queue,
      endpoints: endpoints.get(`${row.data.app_type}\0${row.data.id}`) ?? [],
      health: health.get(`${row.data.app_type}\0${row.data.id}`) ?? 'unknown',
    })
  }

  const localSettings = readLocalSettings(settingsPath)
  warnings.push(...localSettings.warnings)
  const currentIds = effectiveCurrentIds(providers, localSettings.settings)
  return {
    providers: providers.map(provider => ({
      ...provider,
      isCurrent: currentIds.get(provider.appType) === provider.id,
    })),
    warnings,
  }
}

export function readCcSwitchSnapshot(config: CcSwitchSourceConfig): CcSwitchSnapshotReadResult {
  if (!existsSync(config.dbPath)) {
    throw new Error(`CC Switch database not found at ${config.dbPath}`)
  }

  const db = new Database(config.dbPath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    db.pragma('busy_timeout = 1000')
    const providerRows = readProviderRows(db, config.settingsPath)
    return {
      providers: providerRows.providers,
      inventory: compactInventory({
        mcpServers: countRows(db, 'mcp_servers'),
        prompts: countRows(db, 'prompts'),
        skills: countRows(db, 'skills'),
        usageRollups: countRows(db, 'usage_daily_rollups'),
        modelPricingEntries: countRows(db, 'model_pricing'),
      }),
      warnings: providerRows.warnings,
    }
  }
  finally {
    db.close()
  }
}

function metadataBase(provider: CcSwitchProviderRow): JsonObject {
  return {
    appType: provider.appType,
    category: provider.category,
    current: provider.isCurrent,
    health: provider.health,
    inFailoverQueue: provider.inFailoverQueue,
    iconSlug: providerIconSlug(provider),
    iconUrl: providerIconUrl(provider),
    sourceUpdatedAt: provider.createdAt ? new Date(provider.createdAt).toISOString() : undefined,
    rawFingerprintHint: textHash({
      id: provider.id,
      appType: provider.appType,
      settingsConfig: provider.settingsConfigRaw,
      meta: provider.metaRaw,
      endpoints: provider.endpoints,
      current: provider.isCurrent,
    }),
  }
}

function providerIconSlug(provider: CcSwitchProviderRow): string | undefined {
  const configuredIconSlug = providerIconSlugFromIcon(provider)
  if (configuredIconSlug) { return configuredIconSlug }
  if (provider.appType === 'claude') { return 'claude' }
  if (provider.appType === 'codex') { return 'codex' }
  if (provider.appType === 'gemini') { return 'gemini' }
  return undefined
}

function optionalStringFromRecord(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') { return undefined }
  const entry = (value as Record<string, unknown>)[key]
  if (typeof entry !== 'string') { return undefined }
  const trimmed = entry.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readJsonRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function parseJwtClaims(token: string | undefined): JsonObject | null {
  if (!token) { return null }
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) { return null }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return readJsonRecord(JSON.parse(Buffer.from(padded, 'base64').toString('utf8')))
  }
  catch {
    return null
  }
}

function chatgptAuthClaim(claims: JsonObject | null, key: string): string | undefined {
  const authClaims = readJsonRecord(claims?.['https://api.openai.com/auth'])
  return optionalStringFromRecord(authClaims, key) ?? optionalStringFromRecord(claims, key)
}

function codexChatgptAuthCredential(
  auth: z.infer<typeof ProviderAuthFieldsSchema>,
  label: string,
): ExternalProviderCredential | undefined {
  const tokens = auth.tokens
  const accessToken = auth.access_token ?? tokens?.access_token
  if (!accessToken) { return undefined }

  const refreshToken = auth.refresh_token ?? tokens?.refresh_token
  const idToken = auth.id_token ?? tokens?.id_token
  const accessClaims = parseJwtClaims(accessToken)
  const idClaims = parseJwtClaims(idToken)
  const chatgptAccountId = auth.chatgptAccountId
    ?? auth.chatgpt_account_id
    ?? auth.account_id
    ?? tokens?.account_id
    ?? chatgptAuthClaim(idClaims, 'chatgpt_account_id')
    ?? chatgptAuthClaim(accessClaims, 'chatgpt_account_id')
  if (!chatgptAccountId) { return undefined }

  const chatgptPlanType = auth.chatgptPlanType
    ?? auth.chatgpt_plan_type
    ?? chatgptAuthClaim(idClaims, 'chatgpt_plan_type')
    ?? chatgptAuthClaim(accessClaims, 'chatgpt_plan_type')
    ?? null

  return {
    kind: 'chatgpt-auth',
    label,
    value: JSON.stringify({
      kind: 'chatgpt-auth',
      accessToken,
      refreshToken: refreshToken ?? null,
      chatgptAccountId,
      chatgptPlanType,
      tokens: compactJsonObject({
        access_token: accessToken,
        refresh_token: refreshToken,
        id_token: idToken,
        account_id: chatgptAccountId,
      }),
    }),
  }
}

function claudeApiFormat(provider: CcSwitchProviderRow): string {
  return provider.meta.apiFormat
    ?? optionalStringFromRecord(provider.settingsConfig, 'apiFormat')
    ?? optionalStringFromRecord(provider.settingsConfig, 'api_format')
    ?? 'anthropic'
}

function isClaudeAnthropicMessages(provider: CcSwitchProviderRow): boolean {
  const apiFormat = claudeApiFormat(provider)
  return apiFormat === 'anthropic' || apiFormat === 'anthropic-messages' || apiFormat === 'anthropic_messages'
}

function isClaudeOfficialSubscriptionProvider(provider: CcSwitchProviderRow): boolean {
  return provider.appType === 'claude' && provider.id === 'claude-official'
}

function mapClaudeProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  const apiFormat = claudeApiFormat(provider)
  if (!isClaudeAnthropicMessages(provider)) { return null }

  const env = provider.settingsConfig.env
  const modelAliases = compactJsonObject({
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  })
  const baseUrl = env.ANTHROPIC_BASE_URL
  const model = env.ANTHROPIC_MODEL
    ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL
    ?? env.ANTHROPIC_DEFAULT_OPUS_MODEL
    ?? env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  const credential = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY
  const authMode = !credential && isClaudeOfficialSubscriptionProvider(provider) ? 'claudeAi' : undefined
  return {
    externalId: `cc-switch:${provider.appType}:${provider.id}`,
    app: provider.appType,
    name: `${provider.name}`,
    providerKind: 'anthropic',
    config: compactJsonObject({
      authMode,
      baseUrl,
      model,
      claudeAgent: Object.keys(modelAliases).length > 0 ? { modelAliases } : undefined,
    }),
    credential: credential ? { kind: 'api-key', value: credential, label: provider.name } : undefined,
    current: provider.isCurrent,
    metadata: compactJsonObject({
      ...metadataBase(provider),
      baseUrl,
      model,
      apiFormat,
      authMode,
    }),
  }
}

function mapCodexProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  const auth = provider.settingsConfig.auth
  const configText = typeof provider.settingsConfig.config === 'string' && provider.settingsConfig.config.trim().length > 0
    ? provider.settingsConfig.config
    : undefined
  if (!configText) { return null }

  const parsedToml = CodexTomlConfigSchema.parse(parseToml(configText))

  const activeProviderId = parsedToml.model_provider
  const activeProvider = activeProviderId ? parsedToml.model_providers[activeProviderId] : undefined
  const baseUrl = activeProvider?.base_url
  const model = parsedToml.model
  const reasoningEffort = parsedToml.model_reasoning_effort
  const approvalPolicy = parsedToml.approval_policy
  const sandboxMode = parsedToml.sandbox_mode
  const wireApi = activeProvider?.wire_api
  const chatgptCredential = (auth.auth_mode === 'chatgpt' || (!auth.OPENAI_API_KEY && auth.tokens?.access_token))
    ? codexChatgptAuthCredential(auth, provider.name)
    : undefined
  const credential: ExternalProviderCredential | undefined = chatgptCredential
    ?? (auth.OPENAI_API_KEY ? { kind: 'api-key', value: auth.OPENAI_API_KEY, label: provider.name } : undefined)
  const usesChatgptAuth = credential?.kind === 'chatgpt-auth'

  return {
    externalId: `cc-switch:${provider.appType}:${provider.id}`,
    app: provider.appType,
    name: `${provider.name}`,
    providerKind: 'openai-compatible',
    config: compactJsonObject({
      baseUrl: usesChatgptAuth ? undefined : baseUrl,
      model,
      reasoningEffort,
      approvalPolicy,
      sandboxMode,
      apiMode: wireApi === 'responses' ? 'responses' : 'chat-completions',
    }),
    credential,
    current: provider.isCurrent,
    metadata: compactJsonObject({
      ...metadataBase(provider),
      baseUrl,
      model,
      reasoningEffort,
      approvalPolicy,
      sandboxMode,
      apiFormat: wireApi === 'responses' ? 'openai_responses' : 'openai_chat',
      authMode: usesChatgptAuth ? 'chatgpt' : undefined,
      credentialKind: credential?.kind,
    }),
  }
}

function mapGeminiProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  const env = provider.settingsConfig.env
  const baseUrl = env.GOOGLE_GEMINI_BASE_URL
  const model = env.GEMINI_MODEL
  const credential = env.GEMINI_API_KEY
  const apiFormat = provider.meta.apiFormat
  const isNativeGoogle = baseUrl ? /generativelanguage\.googleapis\.com/i.test(baseUrl) : true
  const isOpenAiCompatible = apiFormat === 'openai_chat' || apiFormat === 'openai_responses' || !isNativeGoogle
  if (!isOpenAiCompatible) { return null }

  return {
    externalId: `cc-switch:${provider.appType}:${provider.id}`,
    app: provider.appType,
    name: `${provider.name}`,
    providerKind: 'openai-compatible',
    config: compactJsonObject({
      baseUrl,
    }),
    credential: credential ? { kind: 'api-key', value: credential, label: provider.name } : undefined,
    current: provider.isCurrent,
    metadata: compactJsonObject({
      ...metadataBase(provider),
      baseUrl,
      model,
      apiFormat: apiFormat ?? 'openai_chat',
    }),
  }
}

function mapProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  if (provider.appType === 'claude') { return mapClaudeProvider(provider) }
  if (provider.appType === 'codex') { return mapCodexProvider(provider) }
  if (provider.appType === 'gemini') { return mapGeminiProvider(provider) }
  return null
}

function unsupportedWarnings(providers: CcSwitchProviderRow[]): ExternalProviderWarning[] {
  const warnings: ExternalProviderWarning[] = []
  const unsupportedApps = new Map<string, number>()
  for (const provider of providers) {
    if (SUPPORTED_APPS.has(provider.appType)) { continue }
    unsupportedApps.set(provider.appType, (unsupportedApps.get(provider.appType) ?? 0) + 1)
  }
  for (const [appType, count] of unsupportedApps) {
    warnings.push({
      code: 'cc-switch-app-unsupported',
      message: `${count} ${appType} provider${count === 1 ? '' : 's'} detected but not projected by this plugin version.`,
      severity: 'info',
    })
  }
  return warnings
}

function skippedProviderWarning(provider: CcSwitchProviderRow): ExternalProviderWarning {
  if (provider.appType === 'claude' && !isClaudeAnthropicMessages(provider)) {
    const apiFormat = claudeApiFormat(provider)
    return {
      code: 'cc-switch-claude-api-format-unsupported',
      message: `Claude provider "${provider.name}" uses API format "${apiFormat}", which requires CC Switch routing and is not projected as a Cradle Claude provider.`,
      severity: 'info',
    }
  }

  return {
    code: 'cc-switch-provider-unsupported-runtime',
    message: `${provider.appType} provider "${provider.name}" was detected but cannot be projected to a Cradle runtime yet.`,
    severity: 'info',
  }
}

export async function readCcSwitchExternalProviderSnapshot(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot> {
  const config = resolveCcSwitchSourceConfig(ctx)
  const snapshot = readCcSwitchSnapshot(config)
  const skippedWarnings: ExternalProviderWarning[] = []
  const providers = snapshot.providers.flatMap((provider) => {
    let record: ExternalProviderRecord | null
    try {
      record = mapProvider(provider)
    }
    catch (error) {
      skippedWarnings.push({
        code: 'cc-switch-provider-map-failed',
        message: `Skipped CC Switch provider ${provider.appType}/${provider.id} (${provider.name}) because it could not be mapped. ${warningMessage(error)}`,
        severity: 'warning',
      })
      return []
    }
    if (!record && SUPPORTED_APPS.has(provider.appType)) {
      skippedWarnings.push(skippedProviderWarning(provider))
    }
    return record ? [record] : []
  })
  const warnings = [...snapshot.warnings, ...unsupportedWarnings(snapshot.providers), ...skippedWarnings]

  return {
    source: {
      status: warnings.some(warning => warning.severity === 'error') ? 'error' : warnings.some(warning => warning.severity === 'warning') ? 'warning' : 'ok',
      message: `Read ${snapshot.providers.length} CC Switch providers from ${config.dbPath}`,
      observedAt: new Date().toISOString(),
    },
    inventory: snapshot.inventory,
    warnings,
    providers,
  }
}

export function createCcSwitchExternalProviderSource(): ExternalProviderSource {
  return {
    id: 'cc-switch',
    label: 'CC Switch',
    description: 'Reads CC Switch provider settings and mirrors supported providers into Cradle.',
    capabilities: { refresh: true, revealSourceFile: true },
    readSnapshot: readCcSwitchExternalProviderSnapshot,
  }
}
