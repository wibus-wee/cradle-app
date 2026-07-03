import type { ModelDescriptor } from '~/features/agent-runtime/types'

import { pickComposerProfileId } from '../composer-profile-selection'
import type {
  ComposerContext,
  ComposerTargetMode,
  ProviderModelOption,
  RuntimeProviderBinding,
  ThinkingEffort,
} from '../types'
import {
  resolveChatModelId,
  resolveRuntimeOwnedChatProfileId,
} from './chat-selection'

export function readComposerThinkingEffort(value: string | null | undefined): ThinkingEffort {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return null
  }
}

export function resolvePreferredThinkingEffort(input: {
  manualThinkingEffort: ThinkingEffort | undefined
  boundSessionThinkingEffort: ThinkingEffort
  boundAgentThinkingEffort: ThinkingEffort
  selectedAgentThinkingEffort: ThinkingEffort
  lastThinkingEffort: ThinkingEffort
}): {
  thinkingEffort: ThinkingEffort
  usesBoundSessionThinkingEffort: boolean
} {
  if (input.manualThinkingEffort !== undefined) {
    return {
      thinkingEffort: input.manualThinkingEffort,
      usesBoundSessionThinkingEffort: false,
    }
  }

  if (input.boundSessionThinkingEffort !== null) {
    return {
      thinkingEffort: input.boundSessionThinkingEffort,
      usesBoundSessionThinkingEffort: true,
    }
  }

  return {
    thinkingEffort: input.boundAgentThinkingEffort
      ?? input.selectedAgentThinkingEffort
      ?? input.lastThinkingEffort,
    usesBoundSessionThinkingEffort: false,
  }
}

export function resolveComposerProfileId(input: {
  composerUsesModelSelection: boolean
  context: ComposerContext
  targetMode: ComposerTargetMode
  selectedAgentId: string | null
  selectedAgentProviderTargetId: string | null | undefined
  manualProfileId: string | null
  boundAgentProviderTargetId: string | null | undefined
  boundProviderTargetId: string | null | undefined
  boundModelId: string | null | undefined
  providerBinding: RuntimeProviderBinding
  lastProfileId: string | null
  selectableProfiles: ProviderModelOption[]
}): string | null {
  if (!input.composerUsesModelSelection) {
    return null
  }
  if (input.context !== 'chat' && input.targetMode === 'agent' && !input.selectedAgentId) {
    return null
  }
  if (input.selectedAgentProviderTargetId) {
    return input.selectedAgentProviderTargetId
  }
  if (input.manualProfileId && input.selectableProfiles.some(profile => profile.id === input.manualProfileId)) {
    return input.manualProfileId
  }
  if (input.context === 'chat' && input.boundAgentProviderTargetId) {
    return input.boundAgentProviderTargetId
  }
  if (input.context === 'chat') {
    const runtimeOwnedProfileId = resolveRuntimeOwnedChatProfileId({
      boundModelId: input.boundModelId,
      profiles: input.selectableProfiles,
      providerBinding: input.providerBinding,
    })
    return input.boundProviderTargetId
      ?? runtimeOwnedProfileId
      ?? pickComposerProfileId({
        profiles: input.selectableProfiles,
        lastProfileId: input.lastProfileId,
      })
  }
  return pickComposerProfileId({
    profiles: input.selectableProfiles,
    lastProfileId: input.lastProfileId,
  })
}

export function resolveComposerModelId(input: {
  composerUsesModelSelection: boolean
  context: ComposerContext
  targetMode: ComposerTargetMode
  selectedAgentId: string | null
  selectedAgentModelId: string | null | undefined
  manualModelId: string | null
  models: ModelDescriptor[]
  boundAgentModelId: string | null | undefined
  boundAgentProviderTargetId: string | null | undefined
  boundModelId: string | null | undefined
  boundProviderTargetId: string | null | undefined
  manualProfileId: string | null
  profileId: string | null
  lastModelByProfile: Record<string, string | null | undefined>
}): string | null {
  if (!input.composerUsesModelSelection) {
    return null
  }
  if (input.context !== 'chat' && input.targetMode === 'agent' && !input.selectedAgentId) {
    return null
  }
  if (input.manualModelId && input.models.some(model => model.id === input.manualModelId)) {
    return input.manualModelId
  }
  if (input.selectedAgentModelId) {
    return input.selectedAgentModelId
  }
  if (input.context === 'chat') {
    return resolveChatModelId({
      boundAgentModelId: input.boundAgentModelId,
      boundAgentProviderTargetId: input.boundAgentProviderTargetId,
      boundModelId: input.boundModelId,
      boundProviderTargetId: input.boundProviderTargetId,
      manualProfileId: input.manualProfileId,
      models: input.models,
    })
  }
  const persisted = input.profileId ? input.lastModelByProfile[input.profileId] : undefined
  if (persisted && input.models.some(model => model.id === persisted)) {
    return persisted
  }
  return input.models[0]?.id ?? null
}
