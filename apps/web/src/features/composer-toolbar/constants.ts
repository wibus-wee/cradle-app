import type { RuntimeCatalogCapabilityDegradation } from '~/features/agent-runtime/runtime-catalog'
import type { RuntimeSelectorOption } from '~/features/agent-runtime/runtime-selector'
import type { ModelDescriptor } from '~/features/agent-runtime/types'

import type { ThinkingOption } from './provider-model-menu'
import type { ThinkingEffort } from './types'

type ConcreteThinkingEffort = NonNullable<ThinkingEffort>

export const THINKING_EFFORTS: { value: ConcreteThinkingEffort, label: string, description: string }[] = [
  { value: 'none', label: '', description: '' },
  { value: 'minimal', label: '', description: '' },
  { value: 'low', label: '', description: '' },
  { value: 'medium', label: '', description: '' },
  { value: 'high', label: '', description: '' },
  { value: 'xhigh', label: '', description: '' },
  { value: 'max', label: '', description: '' },
  { value: 'ultra', label: '', description: '' },
]

export interface RuntimeKindOption extends RuntimeSelectorOption {
  degradations?: RuntimeCatalogCapabilityDegradation[]
}

export type ThinkingCapabilityTier = 'none' | 'standard' | 'extended'

const EXTENDED_REASONING_EFFORTS = new Set(['minimal', 'xhigh', 'max', 'ultra'])

/**
 * Returns declared effort values when the server/registry set `reasoningEfforts`
 * (including an empty list). `undefined` means "not declared" → heuristic fallback.
 */
function readDeclaredReasoningEfforts(model: ModelDescriptor | null | undefined): Set<string> | undefined {
  if (model?.capabilities.reasoning === false) {
    return new Set()
  }
  const efforts = model?.capabilities.reasoningEfforts
  if (efforts !== undefined) {
    return new Set(efforts)
  }
  return undefined
}

export function getThinkingCapabilityTier(model: ModelDescriptor | null | undefined): ThinkingCapabilityTier {
  if (model?.capabilities.reasoning !== true) {
    return 'none'
  }

  const declared = readDeclaredReasoningEfforts(model)
  if (declared !== undefined) {
    if (declared.size === 0) {
      return 'none'
    }
    for (const effort of declared) {
      if (EXTENDED_REASONING_EFFORTS.has(effort)) {
        return 'extended'
      }
    }
    return 'standard'
  }

  return 'standard'
}

export function filterThinkingOptionsForModel<TThinking extends string | null>(
  model: ModelDescriptor | null | undefined,
  options: Array<ThinkingOption<TThinking>>,
): Array<ThinkingOption<TThinking>> {
  const declared = readDeclaredReasoningEfforts(model)
  if (declared !== undefined) {
    // Explicit list (possibly empty): never invent tiers via heuristic.
    return options.filter(option => option.value === null || declared.has(option.value))
  }

  const tier = getThinkingCapabilityTier(model)

  return options.filter((option) => {
    if (option.value === null) {
      return true
    }
    if (tier === 'none') {
      return false
    }
    if (option.value === 'none' || option.value === 'minimal' || option.value === 'xhigh' || option.value === 'max' || option.value === 'ultra') {
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
  if (supportedOptions.some(option => option.value === fallback)) {
    return fallback
  }
  return supportedOptions[0]?.value ?? fallback
}
