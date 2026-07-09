import type { Agent as OpenCodeAgent, Config, ProviderListResponse } from '@opencode-ai/sdk'

import type {
  RuntimeKind,
  RuntimeModelCatalog,
  RuntimeModelDescriptor,
} from '../../chat-runtime/runtime-provider-types'
import type { ProviderKind } from '../../provider-contracts/types'
import {
  OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
  readOpenCodeRuntimeNativeProviderId,
  toOpenCodeRuntimeNativeProviderTargetId,
} from './native-provider-target-id'
import { acquireOpencodeRuntimeResource } from './runtime-context'

export {
  isOpenCodeRuntimeNativeProviderTargetId,
  OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
  OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_PREFIX,
  readOpenCodeRuntimeNativeProviderId,
  toOpenCodeRuntimeNativeProviderTargetId,
} from './native-provider-target-id'

const OPENCODE_MODEL_CATALOG_SCOPE_ID = 'model-catalog'

type OpenCodeProvider = ProviderListResponse['all'][number]
type OpenCodeModel = OpenCodeProvider['models'][string]
type OpenCodeReasoningEffort = NonNullable<RuntimeModelDescriptor['capabilities']['reasoningEfforts']>[number]

interface OpenCodeVariantConfig {
  reasoningEffort?: string
  reasoning_effort?: string
  effort?: string
  thinking?: unknown
  thinkingConfig?: {
    thinkingLevel?: string
    thinking_level?: string
  }
  thinking_config?: {
    thinkingLevel?: string
    thinking_level?: string
  }
  reasoning?: {
    effort?: string
  }
  reasoningConfig?: {
    maxReasoningEffort?: string
    max_reasoning_effort?: string
  }
  reasoning_config?: {
    maxReasoningEffort?: string
    max_reasoning_effort?: string
  }
}

const OPENCODE_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly OpenCodeReasoningEffort[]

export interface OpencodeRuntimeProviderGroup {
  id: string
  nativeProviderId: string
  label: string
  providerKind: ProviderKind
  modelCount: number
}

export interface OpencodeRuntimeAgentDescriptor {
  id: string
  label: string
  description: string | null
  mode: OpenCodeAgent['mode']
  builtIn: boolean
  modelId: string | null
}

export async function listOpencodeRuntimeModels(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}): Promise<RuntimeModelCatalog> {
  const providers = await listOpenCodeProviders(input)
  const models = flattenOpenCodeProviders({
    runtimeKind: input.runtimeKind,
    providers,
  })
  return {
    runtimeKind: input.runtimeKind,
    source: 'opencode-sdk',
    fetchedAt: currentUnixSeconds(),
    models,
  }
}

export async function listOpencodeRuntimeProviderGroups(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}): Promise<OpencodeRuntimeProviderGroup[]> {
  const providers = await listOpenCodeProviders(input)
  return providers
    .map(provider => ({
      id: toOpenCodeRuntimeNativeProviderTargetId(provider.id),
      nativeProviderId: provider.id,
      label: provider.name || provider.id,
      providerKind: projectOpenCodeProviderKind(provider),
      modelCount: Object.keys(provider.models).length,
    }))
    .filter(group => group.modelCount > 0)
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function listOpencodeRuntimeAgents(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}): Promise<OpencodeRuntimeAgentDescriptor[]> {
  const lease = await acquireOpencodeRuntimeResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
    chatSessionId: OPENCODE_MODEL_CATALOG_SCOPE_ID,
    config: {} satisfies Config,
  })
  try {
    const result = await lease.resource.client.app.agents({
      ...(input.workspacePath ? { query: { directory: input.workspacePath } } : {}),
    })
    if (result.error || !result.data) {
      return []
    }
    return result.data.map(agent => ({
      id: agent.name,
      label: agent.name,
      description: agent.description ?? null,
      mode: agent.mode,
      builtIn: agent.builtIn,
      modelId: agent.model ? toOpenCodeModelRef(agent.model.providerID, agent.model.modelID) : null,
    })).sort((left, right) => left.label.localeCompare(right.label))
  }
  finally {
    lease.release()
  }
}

export async function listOpencodeRuntimeModelsForProviderTarget(input: {
  runtimeKind: RuntimeKind
  providerTargetId: string
  workspacePath?: string
}): Promise<RuntimeModelDescriptor[]> {
  const nativeProviderId = readOpenCodeRuntimeNativeProviderId(input.providerTargetId)
  if (!nativeProviderId) {
    return []
  }
  const catalog = await listOpencodeRuntimeModels(input)
  return catalog.models.filter(model => model.nativeProviderId === nativeProviderId)
}

async function listOpenCodeProviders(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}): Promise<OpenCodeProvider[]> {
  const lease = await acquireOpencodeRuntimeResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
    chatSessionId: OPENCODE_MODEL_CATALOG_SCOPE_ID,
    config: {} satisfies Config,
  })
  try {
    const result = await lease.resource.client.provider.list({
      ...(input.workspacePath ? { query: { directory: input.workspacePath } } : {}),
    })
    if (result.error) {
      throw result.error
    }
    if (!result.data) {
      throw new Error('OpenCode provider list returned no data.')
    }
    return filterConnectedOpenCodeProviders(result.data)
  }
  finally {
    lease.release()
  }
}

function filterConnectedOpenCodeProviders(providerList: ProviderListResponse): OpenCodeProvider[] {
  const connected = new Set(providerList.connected)
  if (connected.size === 0) {
    return []
  }
  return providerList.all.filter(provider => connected.has(provider.id))
}

export function flattenOpenCodeProviders(input: {
  runtimeKind: RuntimeKind
  providers: OpenCodeProvider[]
}): RuntimeModelDescriptor[] {
  return input.providers.flatMap(provider =>
    Object.values(provider.models)
      .map(model => projectOpenCodeModel(input.runtimeKind, provider, model))
      .sort((left, right) => left.label.localeCompare(right.label)))
}

function projectOpenCodeModel(
  runtimeKind: RuntimeKind,
  provider: OpenCodeProvider,
  model: OpenCodeModel,
): RuntimeModelDescriptor {
  const id = toOpenCodeModelRef(provider.id, model.id)
  const reasoningEfforts = readOpenCodeModelReasoningEfforts(model)
  return {
    id,
    label: model.name || id,
    providerKind: projectOpenCodeProviderKind(provider),
    capabilities: {
      contextWindow: model.limit.context,
      maxOutput: model.limit.output,
      ...(model.modalities?.input ? { inputModalities: model.modalities.input } : {}),
      ...(model.modalities?.output ? { outputModalities: model.modalities.output } : {}),
      reasoning: model.reasoning,
      ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
      toolCall: model.tool_call,
      temperature: model.temperature,
      ...(model.cost
        ? {
            cost: {
              input: model.cost.input,
              output: model.cost.output,
              ...(model.cost.cache_read === undefined ? {} : { cacheRead: model.cost.cache_read }),
              ...(model.cost.cache_write === undefined ? {} : { cacheWrite: model.cost.cache_write }),
            },
          }
        : {}),
      releaseDate: model.release_date,
    },
    runtimeKind,
    source: 'opencode-sdk',
    nativeProviderId: provider.id,
  }
}

function readOpenCodeModelReasoningEfforts(model: OpenCodeModel): OpenCodeReasoningEffort[] {
  const variants = readOpenCodeModelVariants(model)
  return Array.from(new Set(
    Object.entries(variants).flatMap(([variantKey, variant]) => {
      const value = readOpenCodeVariantReasoningEffort(variantKey, variant)
      return value ? [value] : []
    }),
  ))
}

function readOpenCodeModelVariants(model: OpenCodeModel): Record<string, OpenCodeVariantConfig> {
  const variants = (model as OpenCodeModel & { variants?: unknown }).variants
  if (!isRecord(variants)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(variants).flatMap(([key, value]) =>
      isRecord(value)
        ? [[key, value as OpenCodeVariantConfig]]
        : []),
  )
}

function readOpenCodeVariantReasoningEffort(
  variantKey: string,
  variant: OpenCodeVariantConfig,
): OpenCodeReasoningEffort | null {
  const value = trimToNull(variant.reasoningEffort)
    ?? trimToNull(variant.reasoning_effort)
    ?? trimToNull(variant.effort)
    ?? trimToNull(variant.thinkingConfig?.thinkingLevel)
    ?? trimToNull(variant.thinkingConfig?.thinking_level)
    ?? trimToNull(variant.thinking_config?.thinkingLevel)
    ?? trimToNull(variant.thinking_config?.thinking_level)
    ?? trimToNull(variant.reasoning?.effort)
    ?? trimToNull(variant.reasoningConfig?.maxReasoningEffort)
    ?? trimToNull(variant.reasoningConfig?.max_reasoning_effort)
    ?? trimToNull(variant.reasoning_config?.maxReasoningEffort)
    ?? trimToNull(variant.reasoning_config?.max_reasoning_effort)

  if (value) {
    return toOpenCodeReasoningEffort(value)
  }

  if (
    'thinking' in variant
    || 'thinkingConfig' in variant
    || 'thinking_config' in variant
    || 'reasoning' in variant
    || 'reasoningConfig' in variant
    || 'reasoning_config' in variant
    || Object.keys(variant).length === 0
  ) {
    return toOpenCodeReasoningEffort(variantKey)
  }

  return null
}

function toOpenCodeReasoningEffort(value: string): OpenCodeReasoningEffort | null {
  const normalized = value.trim()
  return OPENCODE_REASONING_EFFORTS.find(effort => effort === normalized) ?? null
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function projectOpenCodeProviderKind(provider: OpenCodeProvider): ProviderKind {
  if (provider.api === 'anthropic') {
    return 'anthropic'
  }
  if (provider.api === 'openai' || provider.api === 'openai-compatible') {
    return 'openai-compatible'
  }
  return 'universal'
}

function toOpenCodeModelRef(providerId: string, modelId: string): string {
  return modelId.includes('/') ? modelId : `${providerId}/${modelId}`
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
