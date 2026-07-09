import type { ModelCapabilities, ModelDescriptor, ProviderKind } from '../provider-contracts/types'

const ANTHROPIC_INPUT_MODALITIES = ['text', 'image'] as const
const ANTHROPIC_OUTPUT_MODALITIES = ['text'] as const
const CLAUDE_AGENT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const CLAUDE_AGENT_REASONING_MODEL_RE = /(?:^|[\s/:_-])claude-(?:3[.-]7|opus-4|sonnet-4)(?:$|[\s:._-])/

export function readProviderDefaultModelCapabilities(providerKind: ProviderKind): ModelCapabilities {
  if (providerKind !== 'anthropic') {
    return {}
  }
  return {
    inputModalities: [...ANTHROPIC_INPUT_MODALITIES],
    outputModalities: [...ANTHROPIC_OUTPUT_MODALITIES],
  }
}

function readProviderReasoningEfforts(model: ModelDescriptor): ModelCapabilities['reasoningEfforts'] {
  if (model.capabilities.reasoning === false) {
    return undefined
  }

  if (model.capabilities.reasoningEfforts?.length) {
    return [...model.capabilities.reasoningEfforts]
  }

  const searchable = `${model.id} ${model.capabilities.family ?? ''}`.toLowerCase()
  if (model.providerKind === 'anthropic') {
    return CLAUDE_AGENT_REASONING_MODEL_RE.test(searchable)
      ? [...CLAUDE_AGENT_REASONING_EFFORTS]
      : undefined
  }

  return undefined
}

export function projectProviderModelCapabilities(model: ModelDescriptor): ModelDescriptor {
  const defaults = readProviderDefaultModelCapabilities(model.providerKind)
  if (!defaults.inputModalities?.length && !defaults.outputModalities?.length) {
    const reasoningEfforts = readProviderReasoningEfforts(model)
    return reasoningEfforts
      ? {
          ...model,
          capabilities: {
            ...model.capabilities,
            reasoning: true,
            reasoningEfforts,
          },
        }
      : model
  }

  const capabilities: ModelCapabilities = { ...model.capabilities }
  if (!capabilities.inputModalities?.length && defaults.inputModalities?.length) {
    capabilities.inputModalities = [...defaults.inputModalities]
  }
  if (!capabilities.outputModalities?.length && defaults.outputModalities?.length) {
    capabilities.outputModalities = [...defaults.outputModalities]
  }
  const reasoningEfforts = readProviderReasoningEfforts(model)
  if (reasoningEfforts?.length) {
    capabilities.reasoning = true
    capabilities.reasoningEfforts = [...reasoningEfforts]
  }

  return {
    ...model,
    capabilities,
  }
}

export function projectProviderModelListCapabilities(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.map(projectProviderModelCapabilities)
}
