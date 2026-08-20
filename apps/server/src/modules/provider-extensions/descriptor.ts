import type { ProviderTarget } from '@cradle/db'
import type {
  ProviderExtensionJsonValue,
  ProviderExtensionTargetDescriptor,
} from '@cradle/plugin-sdk/server'

function readModels(raw: string): string[] {
  return JSON.parse(raw) as string[]
}

function compactJsonObject(
  entries: Array<[string, ProviderExtensionJsonValue | undefined]>,
): { [key: string]: ProviderExtensionJsonValue } {
  return Object.fromEntries(entries.filter((entry): entry is [string, ProviderExtensionJsonValue] => entry[1] !== undefined))
}

function readSafeConnectionConfig(
  target: ProviderTarget,
): { [key: string]: ProviderExtensionJsonValue } {
  const config = JSON.parse(target.connectionConfigJson) as {
    baseUrl?: string | null
    openaiBaseUrl?: string | null
    anthropicBaseUrl?: string | null
    authMode?: string
    apiMode?: string
  }
  switch (target.providerKind) {
    case 'openai-compatible': {
      return compactJsonObject([
        ['baseUrl', config.baseUrl],
        ['authMode', config.authMode],
        ['apiMode', config.apiMode],
      ])
    }
    case 'anthropic': {
      return compactJsonObject([
        ['baseUrl', config.baseUrl],
        ['authMode', config.authMode],
      ])
    }
    case 'universal': {
      return compactJsonObject([
        ['baseUrl', config.baseUrl],
        ['openaiBaseUrl', config.openaiBaseUrl],
        ['anthropicBaseUrl', config.anthropicBaseUrl],
      ])
    }
  }
}

export function createProviderExtensionTargetDescriptor(input: {
  target: ProviderTarget
  credentialKind: string | null
}): ProviderExtensionTargetDescriptor {
  const modelIds = readModels(input.target.enabledModelsJson)
  const connectionConfig = readSafeConnectionConfig(input.target)
  return {
    id: input.target.id,
    name: input.target.displayName,
    enabled: input.target.enabled,
    targetKind: input.target.kind,
    providerKind: input.target.providerKind,
    connectionConfig,
    config: {
      ...connectionConfig,
      enabledModels: modelIds,
    },
    credentialKind: input.credentialKind === 'chatgpt-auth' ? 'chatgpt-auth' : input.credentialKind ? 'api-key' : null,
    modelIds,
  }
}
