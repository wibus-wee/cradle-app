/**
 * Output: opencode-native provider config and model selection.
 * Input: Cradle runtime provider target profile, requested model, and secret reader.
 * Position: opencode provider package boundary from Cradle provider targets to opencode config.
 */

import type { Config } from '@opencode-ai/sdk'

import type { RegisteredMcpServer } from '../../../plugins/mcp-registry'
import { getRegisteredMcpServers } from '../../../plugins/mcp-registry'
import type { RuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'
import type { ModelRegistryMappingEntry, ModelsDevModel } from '../../model-registry/model-info-registry'
import { lookupModelRawExact } from '../../model-registry/model-info-registry'
import { resolveAnthropicWireAuth } from '../../provider-catalog/provider-endpoint-registry'
import {
  readTrustedAnthropicConfig,
  readTrustedOpenAICompatibleConfig,
  readTrustedUniversalConfig,
} from '../../provider-contracts/provider-base'
import type { CustomModelEntry } from '../../provider-targets/service'

export interface OpencodeResolvedConfig {
  config: Config
  model: {
    providerID: string
    modelID: string
  } | null
  modelId: string | null
  requestedModelId: string | null
}

interface ResolveOpencodeConfigInput {
  profile: RuntimeProviderTargetProfile
  requestedModelId?: string | null
  readSecret: (credentialRef: string) => string
}

interface OpencodeProviderProjection {
  providerID: string
  modelID: string | null
  requestedModelId: string | null
  models: Record<string, OpencodeModelConfig>
  baseURL: string | null
  apiKey: string | null
  authToken: string | null
  api: string
  npm: string
}

type OpencodeModelConfig = NonNullable<NonNullable<Config['provider']>[string]['models']>[string]
type OpencodeMcpConfig = NonNullable<Config['mcp']>[string]

const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gpt-4o'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

export async function resolveOpencodeConfig(input: ResolveOpencodeConfigInput): Promise<OpencodeResolvedConfig> {
  const projection = await projectOpencodeProvider(input)
  const providerConfig: Config['provider'] = {
    [projection.providerID]: {
      id: projection.providerID,
      name: input.profile.name,
      api: projection.api,
      npm: projection.npm,
      options: {
        ...(projection.baseURL ? { baseURL: projection.baseURL } : {}),
        ...(projection.apiKey ? { apiKey: projection.apiKey } : {}),
        ...(projection.authToken ? { authToken: projection.authToken } : {}),
        timeout: false,
      },
      models: projection.models,
    },
  }
  const mcpConfig = buildOpencodeMcpServersConfig()

  const modelId = projection.modelID
    ? `${projection.providerID}/${projection.modelID}`
    : null

  return {
    config: {
      model: modelId ?? undefined,
      provider: providerConfig,
      ...(Object.keys(mcpConfig).length > 0 ? { mcp: mcpConfig } : {}),
    },
    model: projection.modelID
      ? {
          providerID: projection.providerID,
          modelID: projection.modelID,
        }
      : null,
    modelId,
    requestedModelId: projection.requestedModelId,
  }
}

async function projectOpencodeProvider(input: ResolveOpencodeConfigInput): Promise<OpencodeProviderProjection> {
  const providerID = createOpencodeProviderId(input.profile)
  const credential = input.profile.credentialRef
    ? input.readSecret(input.profile.credentialRef)
    : null

  if (input.profile.providerKind === 'anthropic') {
    const config = readTrustedAnthropicConfig(input.profile.configJson)
    const currentModel = input.requestedModelId ?? config.model
    const modelID = readModelID(currentModel, DEFAULT_ANTHROPIC_MODEL)
    const auth = projectAnthropicProviderAuth(config.baseUrl, credential)
    return {
      providerID,
      modelID,
      requestedModelId: currentModel ?? modelID,
      models: await buildOpencodeModels(input, modelID, currentModel, config.enabledModels),
      baseURL: config.baseUrl,
      apiKey: auth.apiKey,
      authToken: auth.authToken,
      api: 'anthropic',
      npm: '@ai-sdk/anthropic',
    }
  }

  if (input.profile.providerKind === 'universal') {
    const config = readTrustedUniversalConfig(input.profile.configJson)
    const currentModel = input.requestedModelId ?? config.model
    const providerFamily = inferUniversalProviderFamily(currentModel, config)
    const baseURL = providerFamily === 'anthropic'
      ? config.anthropicBaseUrl
      : config.openaiBaseUrl
    const modelID = readModelID(
      currentModel,
      providerFamily === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_COMPATIBLE_MODEL,
    )
    return {
      providerID,
      modelID,
      requestedModelId: currentModel ?? modelID,
      models: await buildOpencodeModels(input, modelID, currentModel, config.enabledModels),
      baseURL,
      apiKey: credential,
      authToken: null,
      api: providerFamily === 'anthropic' ? 'anthropic' : 'openai-compatible',
      npm: providerFamily === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
    }
  }

  const config = readTrustedOpenAICompatibleConfig(input.profile.configJson)
  const currentModel = input.requestedModelId ?? config.model
  const modelID = readModelID(currentModel, DEFAULT_OPENAI_COMPATIBLE_MODEL)
  const providerApi = projectOpenAICompatibleProviderApi(config.apiMode)
  return {
    providerID,
    modelID,
    requestedModelId: currentModel ?? modelID,
    models: await buildOpencodeModels(input, modelID, currentModel, config.enabledModels),
    baseURL: config.baseUrl,
    apiKey: credential,
    authToken: null,
    api: providerApi.api,
    npm: providerApi.npm,
  }
}

function projectAnthropicProviderAuth(
  baseUrl: string | null,
  credential: string | null,
): Pick<OpencodeProviderProjection, 'apiKey' | 'authToken'> {
  if (!credential) {
    return { apiKey: null, authToken: null }
  }
  if (resolveAnthropicWireAuth(baseUrl) === 'bearer-token') {
    return { apiKey: null, authToken: credential }
  }
  return { apiKey: credential, authToken: null }
}

function projectOpenAICompatibleProviderApi(
  apiMode: ReturnType<typeof readTrustedOpenAICompatibleConfig>['apiMode'],
): Pick<OpencodeProviderProjection, 'api' | 'npm'> {
  if (apiMode === 'responses') {
    return {
      api: 'openai',
      npm: '@ai-sdk/openai',
    }
  }
  return {
    api: 'openai-compatible',
    npm: '@ai-sdk/openai-compatible',
  }
}

async function buildOpencodeModels(
  input: ResolveOpencodeConfigInput,
  selectedModelId: string,
  currentModelId: string | null | undefined,
  enabledModels: string[],
): Promise<Record<string, OpencodeModelConfig>> {
  const customModels = JSON.parse(input.profile.customModels) as CustomModelEntry[]
  const registryMappings = readModelRegistryMappings(input.profile.configJson)
  const models = new Map<string, OpencodeModelConfig>()
  const pushModel = async (modelId: string | null | undefined, label?: string): Promise<void> => {
    if (!modelId) {
      return
    }
    const id = readModelID(modelId, modelId)
    const registryModel = await resolveMappedRegistryModel(registryMappings, [modelId, id])
    models.set(id, {
      id,
      ...projectRegistryModelConfig(registryModel),
      name: registryModel?.name ?? label ?? id,
    })
  }

  await pushModel(selectedModelId)
  await pushModel(currentModelId)
  await pushModel(input.requestedModelId)
  for (const modelId of enabledModels) {
    await pushModel(modelId)
  }
  for (const model of customModels) {
    await pushModel(model.id, model.label)
  }

  return Object.fromEntries(models)
}

function readModelRegistryMappings(rawConfigJson: string): ModelRegistryMappingEntry[] {
  const config = JSON.parse(rawConfigJson) as { modelRegistryMappings?: ModelRegistryMappingEntry[] }
  return config.modelRegistryMappings ?? []
}

async function resolveMappedRegistryModel(
  mappings: ModelRegistryMappingEntry[],
  modelIds: string[],
): Promise<ModelsDevModel | null> {
  const mapping = mappings.find(candidate => modelIds.includes(candidate.modelId))
  if (!mapping) {
    return null
  }
  if (mapping.model) {
    return mapping.model
  }
  if (!mapping.registryModelId) {
    return null
  }
  return await lookupModelRawExact(mapping.registryModelId)
}

function projectRegistryModelConfig(model: ModelsDevModel | null): Partial<OpencodeModelConfig> {
  if (!model) {
    return {}
  }
  return {
    ...(model.release_date ? { release_date: model.release_date } : {}),
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.tool_call === undefined ? {} : { tool_call: model.tool_call }),
    ...(model.limit ? { limit: projectRegistryModelLimit(model.limit) } : {}),
    ...(model.cost ? { cost: projectRegistryModelCost(model.cost) } : {}),
    ...(model.modalities ? { modalities: projectRegistryModelModalities(model.modalities) } : {}),
  }
}

function projectRegistryModelLimit(limit: NonNullable<ModelsDevModel['limit']>): NonNullable<OpencodeModelConfig['limit']> {
  return {
    context: limit.context ?? 0,
    output: limit.output ?? 0,
  }
}

function projectRegistryModelCost(cost: NonNullable<ModelsDevModel['cost']>): NonNullable<OpencodeModelConfig['cost']> {
  return {
    input: cost.input ?? 0,
    output: cost.output ?? 0,
    ...(cost.cache_read === undefined ? {} : { cache_read: cost.cache_read }),
    ...(cost.cache_write === undefined ? {} : { cache_write: cost.cache_write }),
  }
}

function projectRegistryModelModalities(
  modalities: NonNullable<ModelsDevModel['modalities']>,
): NonNullable<OpencodeModelConfig['modalities']> {
  return {
    input: projectModelModalities(modalities.input),
    output: projectModelModalities(modalities.output),
  }
}

function projectModelModalities(modalities: string[] | undefined): Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> {
  if (!modalities) {
    return ['text']
  }
  return modalities.filter((modality): modality is 'text' | 'audio' | 'image' | 'video' | 'pdf' =>
    modality === 'text'
    || modality === 'audio'
    || modality === 'image'
    || modality === 'video'
    || modality === 'pdf')
}

function inferUniversalProviderFamily(
  modelId: string | null | undefined,
  config: ReturnType<typeof readTrustedUniversalConfig>,
): 'anthropic' | 'openai-compatible' {
  const providerPrefix = readProviderPrefix(modelId)
  if (providerPrefix === 'anthropic') {
    return 'anthropic'
  }
  if (providerPrefix === 'openai' || providerPrefix === 'openai-compatible') {
    return 'openai-compatible'
  }
  if (config.anthropicBaseUrl && !config.openaiBaseUrl) {
    return 'anthropic'
  }
  return 'openai-compatible'
}

function readProviderPrefix(modelId: string | null | undefined): string | null {
  if (!modelId) {
    return null
  }
  const slashIndex = modelId.indexOf('/')
  return slashIndex > 0 ? modelId.slice(0, slashIndex) : null
}

function readModelID(modelId: string | null | undefined, fallback: string): string {
  if (!modelId) {
    return fallback
  }
  const slashIndex = modelId.indexOf('/')
  return slashIndex > 0 ? modelId.slice(slashIndex + 1) : modelId
}

function createOpencodeProviderId(profile: RuntimeProviderTargetProfile): string {
  return `cradle-${profile.providerTargetKind}-${profile.providerTargetId.replace(/[^\w-]/g, '-')}`
}

function buildOpencodeMcpServersConfig(): NonNullable<Config['mcp']> {
  return Object.fromEntries(
    Object.entries(getRegisteredMcpServers()).map(([name, config]) => [name, projectOpencodeMcpServer(config)]),
  )
}

function projectOpencodeMcpServer(config: RegisteredMcpServer): OpencodeMcpConfig {
  if (config.transport === 'stdio') {
    return {
      type: 'local',
      command: [config.command, ...config.args],
      enabled: true,
      ...(Object.keys(config.env).length > 0 ? { environment: config.env } : {}),
    }
  }

  return {
    type: 'remote',
    url: config.url,
    enabled: true,
    ...(Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
  }
}
