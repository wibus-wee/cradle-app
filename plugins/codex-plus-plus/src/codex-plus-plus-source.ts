/* 读取 Codex++ 本地 relay profiles，并映射成 Cradle external provider snapshot。 */

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
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

type JsonObject = Record<string, unknown>

const NonEmptyStringSchema = z.string().trim().min(1)
const OptionalExternalStringSchema = z.preprocess((value) => {
  if (value === null) { return undefined }
  if (typeof value === 'string' && value.trim().length === 0) { return undefined }
  return value
}, NonEmptyStringSchema.optional())

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

const CodexPlusPlusRelayProfileSchema = z.object({
  id: NonEmptyStringSchema,
  name: OptionalExternalStringSchema,
  upstreamBaseUrl: OptionalExternalStringSchema,
  protocol: OptionalExternalStringSchema,
  relayMode: OptionalExternalStringSchema,
  configContents: z.string().optional().default(''),
  authContents: z.string().optional().default(''),
  modelList: z.string().optional().default(''),
  testModel: OptionalExternalStringSchema,
}).passthrough()

const CodexPlusPlusSettingsSchema = z.object({
  activeRelayId: OptionalExternalStringSchema,
  relayTestModel: OptionalExternalStringSchema,
  relayProfiles: z.array(CodexPlusPlusRelayProfileSchema).default([]),
}).passthrough()

interface CodexPlusPlusSourceConfig {
  settingsPath: string
}

type CodexPlusPlusRelayProfile = z.infer<typeof CodexPlusPlusRelayProfileSchema>
type CodexPlusPlusSettings = z.infer<typeof CodexPlusPlusSettingsSchema>
type CodexTomlConfig = z.infer<typeof CodexTomlConfigSchema>

function warningMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function configValue(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: string): string {
  return ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key] ?? fallback
}

function compactJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function textHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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

function optionalStringFromRecord(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') { return undefined }
  const entry = (value as Record<string, unknown>)[key]
  if (typeof entry !== 'string') { return undefined }
  const trimmed = entry.trim()
  return trimmed.length > 0 ? trimmed : undefined
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

function parseProfileAuth(profile: CodexPlusPlusRelayProfile): z.infer<typeof ProviderAuthFieldsSchema> {
  if (!profile.authContents.trim()) { return {} }
  return z.string()
    .transform(raw => JSON.parse(raw))
    .pipe(ProviderAuthFieldsSchema)
    .parse(profile.authContents)
}

function parseProfileToml(profile: CodexPlusPlusRelayProfile): CodexTomlConfig {
  if (!profile.configContents.trim()) {
    return CodexTomlConfigSchema.parse({})
  }
  return CodexTomlConfigSchema.parse(parseToml(profile.configContents))
}

function modelIdsFromList(modelList: string): string[] {
  return Array.from(new Set(modelList
    .split(/\r?\n/)
    .map(model => model.trim())
    .filter(Boolean)))
}

function apiModeFromProtocol(protocol: string | undefined, wireApi: string | undefined): 'responses' | 'chat-completions' {
  const normalizedProtocol = protocol?.toLowerCase()
  if (normalizedProtocol === 'responses') { return 'responses' }
  if (normalizedProtocol === 'chatcompletions' || normalizedProtocol === 'chat-completions') { return 'chat-completions' }
  return wireApi === 'responses' ? 'responses' : 'chat-completions'
}

function mapCodexPlusPlusProfile(
  profile: CodexPlusPlusRelayProfile,
  settings: CodexPlusPlusSettings,
): ExternalProviderRecord | null {
  const parsedToml = parseProfileToml(profile)
  const activeProviderId = parsedToml.model_provider
  const activeProvider = activeProviderId ? parsedToml.model_providers[activeProviderId] : undefined
  const auth = parseProfileAuth(profile)
  const name = profile.name ?? profile.id
  const models = modelIdsFromList(profile.modelList)
  const model = parsedToml.model ?? profile.testModel ?? models[0] ?? (profile.id === settings.activeRelayId ? settings.relayTestModel : undefined)
  const baseUrl = profile.upstreamBaseUrl ?? activeProvider?.base_url
  const reasoningEffort = parsedToml.model_reasoning_effort
  const approvalPolicy = parsedToml.approval_policy
  const sandboxMode = parsedToml.sandbox_mode
  const apiMode = apiModeFromProtocol(profile.protocol, activeProvider?.wire_api)
  const chatgptCredential = (auth.auth_mode === 'chatgpt' || (!auth.OPENAI_API_KEY && auth.tokens?.access_token))
    ? codexChatgptAuthCredential(auth, name)
    : undefined
  const credential: ExternalProviderCredential | undefined = chatgptCredential
    ?? (auth.OPENAI_API_KEY ? { kind: 'api-key', value: auth.OPENAI_API_KEY, label: name } : undefined)
  const usesChatgptAuth = credential?.kind === 'chatgpt-auth'

  if (!model && !baseUrl && !credential && models.length === 0) {
    return null
  }

  return {
    externalId: `codex-plus-plus:relay:${profile.id}`,
    app: 'codex-plus-plus',
    name,
    providerKind: 'openai-compatible',
    config: compactJsonObject({
      baseUrl: usesChatgptAuth ? undefined : baseUrl,
      model,
      reasoningEffort,
      approvalPolicy,
      sandboxMode,
      apiMode,
    }),
    credential,
    current: profile.id === settings.activeRelayId,
    metadata: compactJsonObject({
      baseUrl,
      model,
      models: models.map(modelId => ({ id: modelId, label: modelId })),
      reasoningEffort,
      approvalPolicy,
      sandboxMode,
      apiFormat: apiMode === 'responses' ? 'openai_responses' : 'openai_chat',
      authMode: usesChatgptAuth ? 'chatgpt' : auth.auth_mode,
      credentialKind: credential?.kind,
      relayMode: profile.relayMode,
      protocol: profile.protocol,
      iconSlug: 'codex',
      rawFingerprintHint: textHash({
        id: profile.id,
        name,
        activeRelayId: settings.activeRelayId,
        upstreamBaseUrl: profile.upstreamBaseUrl,
        protocol: profile.protocol,
        relayMode: profile.relayMode,
        configContents: profile.configContents,
        authContents: profile.authContents,
        modelList: profile.modelList,
      }),
    }),
  }
}

export function resolveCodexPlusPlusSourceConfig(ctx: ExternalProviderSourceReadContext | null = null): CodexPlusPlusSourceConfig {
  return {
    settingsPath: configValue(ctx, 'CODEX_PLUS_PLUS_SETTINGS_PATH', join(homedir(), '.codex-session-delete', 'settings.json')),
  }
}

export function readCodexPlusPlusSettings(path: string): CodexPlusPlusSettings {
  if (!existsSync(path)) {
    throw new Error(`Codex++ settings not found at ${path}`)
  }
  return z.string()
    .transform(raw => JSON.parse(raw))
    .pipe(CodexPlusPlusSettingsSchema)
    .parse(readFileSync(path, 'utf8'))
}

export async function readCodexPlusPlusExternalProviderSnapshot(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot> {
  const config = resolveCodexPlusPlusSourceConfig(ctx)
  const settings = readCodexPlusPlusSettings(config.settingsPath)
  const warnings: ExternalProviderWarning[] = []
  const providers = settings.relayProfiles.flatMap((profile) => {
    try {
      const record = mapCodexPlusPlusProfile(profile, settings)
      return record ? [record] : []
    }
    catch (error) {
      warnings.push({
        code: 'codex-plus-plus-profile-map-failed',
        message: `Skipped Codex++ relay profile ${profile.id} because it could not be mapped. ${warningMessage(error)}`,
        severity: 'warning',
      })
      return []
    }
  })

  return {
    source: {
      status: warnings.some(warning => warning.severity === 'error') ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
      message: `Read ${settings.relayProfiles.length} Codex++ relay profiles from ${config.settingsPath}`,
      observedAt: new Date().toISOString(),
    },
    warnings,
    providers,
  }
}

export function createCodexPlusPlusExternalProviderSource(): ExternalProviderSource {
  return {
    id: 'codex-plus-plus',
    label: 'Codex++',
    description: 'Reads Codex++ relay profile settings and mirrors supported model providers into Cradle.',
    capabilities: { refresh: true, revealSourceFile: true },
    readSnapshot: readCodexPlusPlusExternalProviderSnapshot,
  }
}
