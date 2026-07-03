import type { RuntimeKind } from '~/features/agent-runtime/types'

import type { RuntimeKindOption } from '../constants'
import type { ComposerContext, ComposerTargetMode } from '../types'

export function readFallbackRuntimeKind(input: {
  directRuntimeOptions: RuntimeKindOption[]
  runtimeOptions: RuntimeKindOption[]
}): RuntimeKind {
  return input.directRuntimeOptions[0]?.value ?? input.runtimeOptions[0]?.value ?? ''
}

export function resolveComposerRuntimeKind(input: {
  context: ComposerContext
  boundRuntimeKind?: RuntimeKind | null
  selectedAgentRuntimeKind?: RuntimeKind | null
  targetMode: ComposerTargetMode
  manualAgentRuntimeKind?: RuntimeKind | null
  manualRuntimeKind?: RuntimeKind | null
  lastRuntimeKind?: RuntimeKind | null
  directRuntimeOptions: RuntimeKindOption[]
  fallbackRuntimeKind: RuntimeKind
}): RuntimeKind {
  if (input.context === 'chat') {
    return input.boundRuntimeKind ?? input.fallbackRuntimeKind
  }
  if (input.selectedAgentRuntimeKind) {
    return input.selectedAgentRuntimeKind
  }
  if (input.targetMode === 'agent' && input.manualAgentRuntimeKind) {
    return input.manualAgentRuntimeKind
  }
  const candidate = input.manualRuntimeKind ?? input.lastRuntimeKind ?? input.fallbackRuntimeKind
  return input.directRuntimeOptions.some(option => option.value === candidate)
    ? candidate
    : input.fallbackRuntimeKind
}
