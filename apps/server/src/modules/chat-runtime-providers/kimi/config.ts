import type { RegisteredMcpServer } from '../../../plugins/mcp-registry'
import type { RuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'

export interface KimiProviderConfig {
  id: string
  type: 'openai' | 'anthropic'
  baseUrl: string | null
  defaultModel: string | null
}

export function projectKimiProviderConfig(profile: RuntimeProviderTargetProfile): KimiProviderConfig {
  const config = JSON.parse(profile.configJson) as {
    baseUrl?: string | null
    model?: string | null
    defaultModel?: string | null
    openaiBaseUrl?: string | null
    anthropicBaseUrl?: string | null
  }
  const type = profile.providerKind === 'anthropic' ? 'anthropic' : 'openai'
  const baseUrl = type === 'anthropic'
    ? config.anthropicBaseUrl ?? config.baseUrl ?? null
    : config.openaiBaseUrl ?? config.baseUrl ?? null

  return {
    id: `cradle-${profile.providerTargetId}`,
    type,
    baseUrl,
    defaultModel: config.defaultModel ?? config.model ?? null,
  }
}

export function resolveKimiModelReference(provider: KimiProviderConfig, model: string | null | undefined): string | undefined {
  const selected = model?.trim()
  if (!selected) { return undefined }
  return selected.includes('/') ? selected : `${provider.id}/${selected}`
}

export function renderKimiConfigToml(input: {
  provider: KimiProviderConfig
  credential: string | null
}): string {
  const lines = [
    `[providers.${tomlKey(input.provider.id)}]`,
    `type = ${tomlString(input.provider.type)}`,
  ]
  if (input.provider.baseUrl) {
    lines.push(`base_url = ${tomlString(input.provider.baseUrl)}`)
  }
  if (input.credential) {
    lines.push(`api_key = ${tomlString(input.credential)}`)
  }
  if (input.provider.defaultModel) {
    lines.unshift(`default_model = ${tomlString(`${input.provider.id}/${input.provider.defaultModel}`)}`, '')
    lines.push(`default_model = ${tomlString(input.provider.defaultModel)}`)
  }
  return `${lines.join('\n')}\n`
}

export function renderKimiMcpConfig(servers: Record<string, RegisteredMcpServer>): string {
  return `${JSON.stringify({
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [
        name,
        server.transport === 'stdio'
          ? {
              transport: 'stdio',
              command: server.command,
              args: server.args,
              ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
            }
          : {
              transport: 'http',
              url: server.url,
              ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
            },
      ]),
    ),
  }, null, 2)}\n`
}

function tomlKey(value: string): string {
  return tomlString(value)
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}
