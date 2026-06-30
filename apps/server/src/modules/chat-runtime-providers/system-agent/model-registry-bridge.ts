/**
 * Output: jar-core provider/model options projected from Cradle provider config and model registry data.
 * Input: provider kind, System Agent config, preferences thinking level, and model-registry lookups.
 * Position: System Agent provider package bridge to Cradle-owned model registry.
 */

import type { DefaultRuntimeConfigOptions } from '@hijarvis/core'

import { lookupModelRaw, lookupModelRawExact } from '../../model-registry/model-info-registry'
import * as ModelRegistry from '../../model-registry/service'
import type { SystemAgentConfig } from '../../provider-contracts/provider-base'
import type { JarvisThinkingLevel } from './types'

type RegistryModel = Awaited<ReturnType<typeof lookupModelRaw>>

const EXTENDED_REASONING_MODEL_RE = /(?:^|[\s/:_-])(?:gpt-5(?:\.\d+)?|o1|o3|o4|claude-(?:opus|sonnet)-4|gemini-2\.5-pro|grok-4|deepseek-r1)(?:$|[\s:._-])/

export function inferSystemAgentProviderFromKind(providerKind: string): string {
  switch (providerKind) {
    case 'anthropic': return 'anthropic'
    case 'openai-compatible': return 'openai'
    default: return 'openai'
  }
}

export function inferSystemAgentApiFromKind(providerKind: string): string {
  switch (providerKind) {
    case 'anthropic': return 'anthropic-messages'
    case 'openai-compatible': return 'openai-completions'
    default: return 'openai-completions'
  }
}

export async function resolveSystemAgentRuntimeRegistryModel(modelId: string): Promise<RegistryModel | null> {
  const [registryModel, mappedRegistryModel] = await Promise.all([
    lookupModelRaw(modelId),
    resolveMappedRegistryModel(modelId),
  ])
  return mappedRegistryModel ?? registryModel
}

export function selectSystemAgentThinkingLevel(
  modelId: string,
  requested: JarvisThinkingLevel,
  registryModel: RegistryModel,
): JarvisThinkingLevel | undefined {
  if (registryModel?.reasoning !== true) {
    return undefined
  }
  if (requested === 'minimal') {
    return supportsExtendedThinking(modelId, registryModel.family) ? 'minimal' : 'low'
  }
  if (requested === 'xhigh') {
    return supportsExtendedThinking(modelId, registryModel.family) ? 'xhigh' : 'high'
  }
  return requested
}

export function applySystemAgentModelRegistryConfig(
  runtimeConfigOptions: DefaultRuntimeConfigOptions,
  input: {
    model: string
    registryModel: RegistryModel
    config: Pick<SystemAgentConfig, 'headers' | 'compat'>
  },
): void {
  const modelConfig: NonNullable<DefaultRuntimeConfigOptions['models']>[string] = {}

  if (input.registryModel) {
    if (input.registryModel.limit?.context != null) {
      modelConfig.contextWindow = input.registryModel.limit.context
    }
    if (input.registryModel.limit?.output != null) {
      modelConfig.maxTokens = input.registryModel.limit.output
    }
    if (input.registryModel.reasoning != null) {
      modelConfig.reasoning = input.registryModel.reasoning
    }
    if (input.registryModel.tool_call != null) {
      modelConfig.toolCall = input.registryModel.tool_call
    }
    if (input.registryModel.modalities?.input) {
      modelConfig.input = input.registryModel.modalities.input.filter(
        (m): m is 'text' | 'image' => m === 'text' || m === 'image',
      )
    }
    if (input.registryModel.cost) {
      const cost: NonNullable<typeof modelConfig.cost> = {}
      if (input.registryModel.cost.input != null) {
        cost.input = input.registryModel.cost.input
      }
      if (input.registryModel.cost.output != null) {
        cost.output = input.registryModel.cost.output
      }
      if (input.registryModel.cost.cache_read != null) {
        cost.cacheRead = input.registryModel.cost.cache_read
      }
      if (input.registryModel.cost.cache_write != null) {
        cost.cacheWrite = input.registryModel.cost.cache_write
      }
      if (Object.keys(cost).length > 0) {
        modelConfig.cost = cost
      }
    }
  }

  if (input.config.headers) {
    modelConfig.headers = input.config.headers
  }
  if (input.config.compat) {
    modelConfig.compat = input.config.compat
  }
  if (Object.keys(modelConfig).length > 0) {
    runtimeConfigOptions.models = { [input.model]: modelConfig }
  }
}

async function resolveMappedRegistryModel(modelId: string): Promise<RegistryModel | null> {
  const mapping = ModelRegistry.getMapping(modelId)
  if (!mapping) {
    return null
  }
  if (mapping.model) {
    return mapping.model
  }
  if (!mapping.registryModelId) {
    return null
  }
  return lookupModelRawExact(mapping.registryModelId)
}

function supportsExtendedThinking(modelId: string, family?: string): boolean {
  return EXTENDED_REASONING_MODEL_RE.test(`${modelId} ${family ?? ''}`.toLowerCase())
}
