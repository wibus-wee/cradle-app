import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'

import type { ThinkingOption } from './provider-model-menu'
import type { ThinkingEffort } from './types'

type ConcreteThinkingEffort = NonNullable<ThinkingEffort>

export const THINKING_EFFORTS: { value: ConcreteThinkingEffort, label: string, description: string }[] = [
  { value: 'low', label: '', description: '' },
  { value: 'medium', label: '', description: '' },
  { value: 'high', label: '', description: '' },
  { value: 'xhigh', label: '', description: '' },
]

export interface RuntimeKindOption {
  value: RuntimeKind
  label?: string
  description?: string
  icon?: RuntimeIconDescriptor
  iconKey?: string
}

export type ThinkingCapabilityTier = 'none' | 'standard' | 'extended'

const EXTENDED_REASONING_EFFORTS = new Set(['minimal', 'xhigh', 'max'])

function readModelReasoningEfforts(model: ModelDescriptor | null | undefined): Set<string> | null {
  if (model?.capabilities.reasoning === false) {
    return null
  }
  const efforts = model?.capabilities.reasoningEfforts
  return efforts?.length ? new Set(efforts) : null
}

export function getThinkingCapabilityTier(model: ModelDescriptor | null | undefined): ThinkingCapabilityTier {
  if (model?.capabilities.reasoning !== true) {
    return 'none'
  }

  const reasoningEfforts = readModelReasoningEfforts(model)
  if (reasoningEfforts) {
    for (const effort of reasoningEfforts) {
      if (EXTENDED_REASONING_EFFORTS.has(effort)) {
        return 'extended'
      }
    }
  }

  return 'standard'
}

export function filterThinkingOptionsForModel<TThinking extends string | null>(
  model: ModelDescriptor | null | undefined,
  options: Array<ThinkingOption<TThinking>>,
): Array<ThinkingOption<TThinking>> {
  const reasoningEfforts = readModelReasoningEfforts(model)
  if (reasoningEfforts) {
    return options.filter(option => option.value === null || reasoningEfforts.has(option.value))
  }

  const tier = getThinkingCapabilityTier(model)

  return options.filter((option) => {
    if (option.value === null) {
      return true
    }
    if (tier === 'none') {
      return false
    }
    if (option.value === 'minimal' || option.value === 'xhigh' || option.value === 'max') {
      return tier === 'extended'
    }
    return true
  })
}

export function selectSupportedThinkingValue<TThinking extends string | null>(
  model: ModelDescriptor | null | undefined,
  options: Array<ThinkingOption<TThinking>>,
  current: TThinking,
  fallback: TThinking,
): TThinking {
  const supportedOptions = filterThinkingOptionsForModel(model, options)
  if (supportedOptions.some(option => option.value === current)) {
    return current
  }
  return supportedOptions[0]?.value ?? fallback
}
