import type { ModelDescriptor } from '~/features/agent-runtime/types'
import type { RuntimeCatalogComposer } from '~/features/agent-runtime/use-runtime-catalog'

import { filterThinkingOptionsForModel, THINKING_EFFORTS } from '../constants'
import type { ThinkingOption } from '../provider-model-menu'
import type { ProviderModelOption, RuntimeProviderBinding, ThinkingEffort } from '../types'

export function resolveChatModelId(input: {
  boundAgentModelId: string | null | undefined
  boundAgentProviderTargetId: string | null | undefined
  boundModelId: string | null | undefined
  boundProviderTargetId: string | null | undefined
  manualProfileId: string | null
  models: ModelDescriptor[]
}): string | null {
  const {
    boundAgentModelId,
    boundAgentProviderTargetId,
    boundModelId,
    boundProviderTargetId,
    manualProfileId,
    models,
  } = input
  const canUseBoundAgentModel = !manualProfileId || manualProfileId === boundAgentProviderTargetId
  const canUseBoundSessionModel = !manualProfileId || manualProfileId === boundProviderTargetId

  if (canUseBoundSessionModel && boundModelId && models.some(model => model.id === boundModelId)) {
    return boundModelId
  }
  if (canUseBoundAgentModel && boundAgentModelId && models.some(model => model.id === boundAgentModelId)) {
    return boundAgentModelId
  }
  return models[0]?.id ?? null
}

export function resolveRuntimeOwnedChatProfileId(input: {
  boundModelId: string | null | undefined
  profiles: ProviderModelOption[]
  providerBinding: RuntimeProviderBinding
}): string | null {
  if (input.providerBinding !== 'runtime-owned') {
    return null
  }
  const modelId = input.boundModelId
  const slashIndex = modelId?.indexOf('/') ?? -1
  if (!modelId || slashIndex <= 0) {
    return null
  }
  const providerId = modelId.slice(0, slashIndex)
  return input.profiles.find(profile => profile.externalRecordId === providerId)?.id ?? null
}

export function selectChatThinkingEffort(input: {
  effectiveModel: ModelDescriptor | null
  preferredThinkingEffort: ThinkingEffort
  preservePreferredThinkingEffort?: boolean
  runtimeComposer?: RuntimeCatalogComposer
  thinkingOptions?: Array<ThinkingOption<ThinkingEffort>>
}): ThinkingEffort {
  const thinkingOptions = input.thinkingOptions ?? THINKING_EFFORTS
  if (
    input.preservePreferredThinkingEffort
    && input.preferredThinkingEffort
    && thinkingOptions.some(option => option.value === input.preferredThinkingEffort)
  ) {
    return input.preferredThinkingEffort
  }

  const runtimeThinkingEfforts = typeof input.runtimeComposer?.thinking === 'object'
    ? new Set(input.runtimeComposer.thinking.efforts)
    : null
  const supportedOptions = runtimeThinkingEfforts
    ? thinkingOptions.filter(option => option.value !== null && runtimeThinkingEfforts.has(option.value))
    : filterThinkingOptionsForModel(input.effectiveModel, thinkingOptions)
  if (supportedOptions.some(option => option.value === input.preferredThinkingEffort)) {
    return input.preferredThinkingEffort
  }
  return supportedOptions.some(option => option.value === 'high') ? 'high' : null
}
