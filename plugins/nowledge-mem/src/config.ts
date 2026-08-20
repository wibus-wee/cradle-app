import type { ServerPluginContext } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

export const DEFAULT_NOWLEDGE_MCP_URL = 'http://127.0.0.1:14242/mcp/'

const CONFIG_STORAGE_KEY = 'config'
const API_KEY_SECRET_KEY = 'api-key'

const McpUrlSchema = z.url({ protocol: /^https?$/ })

const StoredConfigSchema = z.object({
  mcpUrl: McpUrlSchema.optional(),
  enabled: z.boolean().optional(),
})

const ConfigUpdateSchema = z.object({
  mcpUrl: McpUrlSchema.optional(),
  enabled: z.boolean().optional(),
  apiKey: z.union([z.string().trim().min(1), z.null()]).optional(),
}).strict()

export type NowledgeApiKeySource = 'plugin' | 'environment' | 'none'

export interface PublicNowledgePluginConfig {
  mcpUrl: string
  enabled: boolean
  hasApiKey: boolean
  apiKeySource: NowledgeApiKeySource
}

export interface NowledgeResolvedConfig extends PublicNowledgePluginConfig {
  apiKey?: string
}

export async function readNowledgePluginConfig(ctx: ServerPluginContext): Promise<NowledgeResolvedConfig> {
  const stored = await readStoredConfig(ctx)
  const pluginApiKey = normalizeOptionalString(ctx.secrets.get(API_KEY_SECRET_KEY) ?? undefined)
  const environmentApiKey = readSharedValue(ctx, 'NMEM_API_KEY')
    ?? normalizeOptionalString(process.env.NMEM_API_KEY)
  const apiKey = pluginApiKey ?? environmentApiKey
  const mcpUrl = stored.mcpUrl
    ?? readSharedValue(ctx, 'NMEM_MCP_URL')
    ?? normalizeOptionalString(process.env.NMEM_MCP_URL)
    ?? DEFAULT_NOWLEDGE_MCP_URL

  return {
    mcpUrl: McpUrlSchema.parse(mcpUrl),
    enabled: stored.enabled ?? true,
    hasApiKey: Boolean(apiKey),
    apiKeySource: pluginApiKey ? 'plugin' : environmentApiKey ? 'environment' : 'none',
    ...(apiKey ? { apiKey } : {}),
  }
}

export async function writeNowledgePluginConfig(
  ctx: ServerPluginContext,
  input: unknown,
): Promise<PublicNowledgePluginConfig> {
  const update = ConfigUpdateSchema.parse(input)
  const current = await readStoredConfig(ctx)
  const nextStored = StoredConfigSchema.parse({
    ...current,
    ...(update.mcpUrl !== undefined ? { mcpUrl: update.mcpUrl } : {}),
    ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
  })

  await ctx.storage.set(CONFIG_STORAGE_KEY, JSON.stringify(nextStored))

  if (update.apiKey === null) {
    ctx.secrets.delete(API_KEY_SECRET_KEY)
  }
  else if (update.apiKey !== undefined) {
    ctx.secrets.set(API_KEY_SECRET_KEY, update.apiKey)
  }

  return projectPublicConfig(await readNowledgePluginConfig(ctx))
}

export async function clearNowledgePluginConfig(ctx: ServerPluginContext): Promise<void> {
  ctx.secrets.delete(API_KEY_SECRET_KEY)
  await ctx.storage.delete(CONFIG_STORAGE_KEY)
}

export function projectPublicConfig(config: NowledgeResolvedConfig): PublicNowledgePluginConfig {
  const { apiKey: _apiKey, ...publicConfig } = config
  return publicConfig
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

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
