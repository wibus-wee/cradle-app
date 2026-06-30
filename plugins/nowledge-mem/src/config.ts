import type { ServerPluginContext } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

export const DEFAULT_NOWLEDGE_API_URL = 'http://127.0.0.1:14242'

const CONFIG_STORAGE_KEY = 'config'

const StoredConfigSchema = z.object({
  apiUrl: z.string().trim().optional(),
  mcpUrl: z.string().trim().optional(),
  spaceId: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  recallEnabled: z.literal(false).optional(),
  captureEnabled: z.literal(false).optional(),
})

const ConfigUpdateSchema = z.object({
  apiUrl: z.string().trim().optional(),
  mcpUrl: z.string().trim().nullable().optional(),
  spaceId: z.string().trim().nullable().optional(),
  enabled: z.boolean().optional(),
  recallEnabled: z.literal(false).optional(),
  captureEnabled: z.literal(false).optional(),
}).passthrough()

export interface NowledgePluginConfig {
  apiUrl: string
  mcpUrl?: string
  spaceId?: string
  enabled: boolean
  recallEnabled: false
  captureEnabled: false
}

export interface NowledgeResolvedConfig extends NowledgePluginConfig {
  apiKey?: string
  hasApiKey: boolean
}

export interface PublicNowledgePluginConfig extends NowledgePluginConfig {
  hasApiKey: boolean
}

export function projectPublicConfig(config: NowledgeResolvedConfig): PublicNowledgePluginConfig {
  const { apiKey: _apiKey, ...publicConfig } = config
  return publicConfig
}

export async function readNowledgePluginConfig(ctx: ServerPluginContext): Promise<NowledgeResolvedConfig> {
  const stored = await readStoredConfig(ctx)
  const sharedApiUrl = readSharedValue(ctx, 'NMEM_API_URL')
  const envApiUrl = process.env.NMEM_API_URL
  const sharedMcpUrl = readSharedValue(ctx, 'NMEM_MCP_URL')
  const envMcpUrl = process.env.NMEM_MCP_URL
  const apiKey = readSharedValue(ctx, 'NMEM_API_KEY') ?? process.env.NMEM_API_KEY
  const apiUrl = normalizeApiUrl(stored.apiUrl ?? sharedApiUrl ?? envApiUrl ?? DEFAULT_NOWLEDGE_API_URL)
  const mcpUrl = normalizeOptionalUrl(stored.mcpUrl ?? sharedMcpUrl ?? envMcpUrl) ?? deriveMcpUrl(apiUrl)
  const spaceId = normalizeOptionalString(stored.spaceId)

  return {
    apiUrl,
    ...(mcpUrl ? { mcpUrl } : {}),
    ...(spaceId ? { spaceId } : {}),
    enabled: stored.enabled ?? true,
    recallEnabled: false,
    captureEnabled: false,
    ...(apiKey ? { apiKey } : {}),
    hasApiKey: Boolean(apiKey),
  }
}

export async function writeNowledgePluginConfig(
  ctx: ServerPluginContext,
  input: unknown,
): Promise<NowledgePluginConfig> {
  const update = ConfigUpdateSchema.parse(input)
  const current = await readStoredConfig(ctx)
  const nextStored = StoredConfigSchema.parse({
    ...current,
    ...(update.apiUrl !== undefined ? { apiUrl: normalizeApiUrl(update.apiUrl) } : {}),
    ...(update.mcpUrl !== undefined ? { mcpUrl: normalizeNullableUrl(update.mcpUrl) } : {}),
    ...(update.spaceId !== undefined ? { spaceId: normalizeNullableString(update.spaceId) } : {}),
    ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
    recallEnabled: false,
    captureEnabled: false,
  })

  await ctx.storage.set(CONFIG_STORAGE_KEY, JSON.stringify(nextStored))

  return {
    apiUrl: normalizeApiUrl(nextStored.apiUrl ?? DEFAULT_NOWLEDGE_API_URL),
    mcpUrl: normalizeOptionalUrl(nextStored.mcpUrl) ?? deriveMcpUrl(normalizeApiUrl(nextStored.apiUrl ?? DEFAULT_NOWLEDGE_API_URL)),
    ...(normalizeOptionalString(nextStored.spaceId) ? { spaceId: normalizeOptionalString(nextStored.spaceId) } : {}),
    enabled: nextStored.enabled ?? true,
    recallEnabled: false,
    captureEnabled: false,
  }
}

async function readStoredConfig(ctx: ServerPluginContext): Promise<z.infer<typeof StoredConfigSchema>> {
  const raw = await ctx.storage.get(CONFIG_STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    return StoredConfigSchema.parse(JSON.parse(raw))
  }
  catch (error) {
    ctx.logger.warn('Ignoring invalid Nowledge Mem plugin config', error)
    return {}
  }
}

function readSharedValue(ctx: ServerPluginContext, key: string): string | undefined {
  return normalizeOptionalString(ctx.sharedConfig.get(key))
}

function normalizeApiUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return DEFAULT_NOWLEDGE_API_URL
  }
  return trimmed.replace(/\/+$/, '')
}

function normalizeNullableUrl(value: string | null | undefined): string | undefined {
  if (value === null) {
    return undefined
  }
  return normalizeOptionalUrl(value)
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(value)
  if (!trimmed) {
    return undefined
  }
  return trimmed.replace(/\/+$/, '')
}

function deriveMcpUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/mcp`
}

function normalizeNullableString(value: string | null | undefined): string | undefined {
  if (value === null) {
    return undefined
  }
  return normalizeOptionalString(value)
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
