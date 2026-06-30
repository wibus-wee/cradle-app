import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { listRuntimeCatalogForSurface, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { useNewChatStore } from '~/store/new-chat'

import { listSelectableComposerProfiles, pickComposerProfileId } from './composer-profile-selection'
import type { RuntimeKindOption } from './constants'
import { filterThinkingOptionsForModel, THINKING_EFFORTS } from './constants'
import type { ThinkingOption } from './provider-model-menu'
import type { ComposerContext, ComposerSelection, ComposerTargetMode, ModelsByProfileId, ProviderModelOption, RuntimeProviderBinding, ThinkingEffort } from './types'

interface ComposerStateConfig {
  context: ComposerContext
  workspaceId?: string | null
  /** Enables Agent as a mutually exclusive new-chat target. Provider-only surfaces leave this off. */
  enableAgents?: boolean
  /** For 'chat' context — the session's bound agent identity */
  boundAgentId?: string | null
  /** For 'chat' context — the session's bound provider target */
  boundProviderTargetId?: string
  /** For 'chat' context — the session's bound requested model */
  boundModelId?: string | null
  /** For 'chat' context — the session's bound requested thinking effort */
  boundThinkingEffort?: ThinkingEffort
  /** For 'chat' context — the session's runtime kind */
  boundRuntimeKind?: RuntimeKind
  /** For 'chat' context — clears local manual overrides when the owning session changes */
  resetKey?: string
}

export interface ComposerStateResult {
  selection: ComposerSelection
  providerBinding: RuntimeProviderBinding
  setAgentId: (id: string | null) => void
  setProfileId: (id: string) => void
  setModelId: (id: string | null, profileId?: string | null) => void
  setThinkingEffort: (effort: ThinkingEffort) => void
  setRuntimeKind: (kind: RuntimeKind) => void
  setTargetMode: (mode: ComposerTargetMode) => void
  resetManualSelection: () => void
  runtimeOptions: RuntimeKindOption[]
  agents: Agent[]
  profiles: ProviderModelOption[]
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  successfulProfileIds: Set<string>
  requestProfileModels: (id: string, options?: { refresh?: boolean }) => void
  agentSelectionEnabled: boolean
  isLoadingAgents: boolean
  isLoadingModels: boolean
  isLoadingProfiles: boolean
  effectiveAgent: Agent | null
  effectiveProfile: ProviderModelOption | null
  effectiveModel: ModelDescriptor | null
}

const EMPTY_MODELS: ModelDescriptor[] = []

function readChatThinkingEffort(value: Agent['thinkingEffort'] | ThinkingEffort | null | undefined): ThinkingEffort {
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

export function selectChatThinkingEffort(input: {
  effectiveModel: ModelDescriptor | null
  preferredThinkingEffort: ThinkingEffort
  preservePreferredThinkingEffort?: boolean
  thinkingOptions?: Array<ThinkingOption<ThinkingEffort>>
  /**
   * Claude Agent owns effort support at the runtime layer. A provider model
   * descriptor may be missing or incomplete, so capability filtering must not
   * clamp the runtime's supported effort choices.
   */
  runtimeKind?: RuntimeKind
}): ThinkingEffort {
  const thinkingOptions = input.thinkingOptions ?? THINKING_EFFORTS
  if (
    input.preservePreferredThinkingEffort
    && input.preferredThinkingEffort
    && thinkingOptions.some(option => option.value === input.preferredThinkingEffort)
  ) {
    return input.preferredThinkingEffort
  }

  const supportedOptions = input.runtimeKind === 'claude-agent'
    ? thinkingOptions
    : filterThinkingOptionsForModel(input.effectiveModel, thinkingOptions)
  if (supportedOptions.some(option => option.value === input.preferredThinkingEffort)) {
    return input.preferredThinkingEffort
  }
  return supportedOptions.some(option => option.value === 'high') ? 'high' : null
}

export function useComposerState(config: ComposerStateConfig): ComposerStateResult {
  const { context, workspaceId, enableAgents = false, boundAgentId, boundProviderTargetId, boundModelId, boundThinkingEffort, boundRuntimeKind, resetKey } = config

  // Persisted state
  const lastRuntimeKind = useNewChatStore(s => s.lastRuntimeKind)
  const setLastRuntimeKind = useNewChatStore(s => s.setLastRuntimeKind)
  const lastAgentId = useNewChatStore(s => s.lastAgentId)
  const setLastAgentId = useNewChatStore(s => s.setLastAgentId)
  const lastProfileId = useNewChatStore(s => s.lastAgentProfileId)
  const setLastProfileId = useNewChatStore(s => s.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(s => s.setLastModelForProfile)
  const lastModelByProfile = useNewChatStore(s => s.lastModelByProfile)
  const lastThinkingEffort = useNewChatStore(s => s.lastThinkingEffort)
  const setLastThinkingEffort = useNewChatStore(s => s.setLastThinkingEffort)

  // Data
  const { agents, isLoading: isLoadingAgents } = useAgents()
  const { providerOptions: baseProviderOptions, isLoading: isLoadingBaseProviders } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()

  // Local non-persisted state
  const [manualAgentId, setManualAgentId] = useState<string | null | undefined>(undefined)
  const [manualProfileId, setManualProfileId] = useState<string | null>(null)
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [manualThinkingEffort, setManualThinkingEffort] = useState<ThinkingEffort | undefined>(undefined)
  const [manualRuntimeKind, setManualRuntimeKind] = useState<RuntimeKind | null>(null)
  const [manualAgentRuntimeKind, setManualAgentRuntimeKind] = useState<RuntimeKind | null>(null)
  const [manualTargetMode, setManualTargetMode] = useState<ComposerTargetMode | undefined>(undefined)
  const [manualSelectionResetKey, setManualSelectionResetKey] = useState<string | undefined>(resetKey)

  const resetManualSelection = useCallback(() => {
    setManualAgentId(undefined)
    setManualProfileId(null)
    setManualModelId(null)
    setManualThinkingEffort(undefined)
    setManualRuntimeKind(null)
    setManualAgentRuntimeKind(null)
    setManualTargetMode(undefined)
    setManualSelectionResetKey(resetKey)
  }, [resetKey])

  useEffect(() => {
    if (context !== 'chat') {
      return
    }
    resetManualSelection()
  }, [context, resetKey, resetManualSelection])
  const canUseManualSelection = context !== 'chat' || manualSelectionResetKey === resetKey
  const effectiveManualAgentId = canUseManualSelection ? manualAgentId : null
  const effectiveManualProfileId = canUseManualSelection ? manualProfileId : null
  const effectiveManualModelId = canUseManualSelection ? manualModelId : null
  const effectiveManualThinkingEffort = canUseManualSelection ? manualThinkingEffort : undefined
  const effectiveManualRuntimeKind = canUseManualSelection ? manualRuntimeKind : null
  const effectiveManualAgentRuntimeKind = canUseManualSelection ? manualAgentRuntimeKind : null
  const effectiveManualTargetMode = canUseManualSelection ? manualTargetMode : undefined

  const runtimeOptions = useMemo<RuntimeKindOption[]>(
    () => listRuntimeCatalogForSurface(runtimes, 'chat').map(runtime => ({
      value: runtime.runtimeKind,
      label: runtime.label,
      description: runtime.description,
      iconKey: runtime.iconKey,
    })),
    [runtimes],
  )
  const runtimeOptionKinds = useMemo(
    () => new Set(runtimeOptions.map(option => option.value)),
    [runtimeOptions],
  )
  const directRuntimeOptions = useMemo(
    () => runtimeOptions.filter(option => option.value !== 'cli-tui'),
    [runtimeOptions],
  )
  const directFallbackRuntimeKind = directRuntimeOptions[0]?.value ?? runtimeOptions[0]?.value ?? 'codex'
  const enabledProviderTargetIds = useMemo(
    () => new Set(baseProviderOptions.filter(option => option.enabled).map(option => option.id)),
    [baseProviderOptions],
  )
  const runtimeBindingByKind = useMemo(() => {
    const bindings = new Map<RuntimeKind, RuntimeProviderBinding>()
    for (const runtime of runtimes) {
      bindings.set(runtime.runtimeKind, runtime.providerBinding ?? 'required')
    }
    return bindings
  }, [runtimes])
  const readRuntimeProviderBinding = useCallback(
    (kind: RuntimeKind): RuntimeProviderBinding => runtimeBindingByKind.get(kind) ?? 'required',
    [runtimeBindingByKind],
  )
  const selectableAgents = useMemo(() => {
    if (!enableAgents) {
      return []
    }
    return agents.filter((agent) => {
      if (!agent.enabled || !runtimeOptionKinds.has(agent.runtimeKind)) {
        return false
      }
      if (agent.runtimeKind === 'cli-tui' || readRuntimeProviderBinding(agent.runtimeKind) === 'runtime-owned') {
        return true
      }
      return !!agent.providerTargetId && enabledProviderTargetIds.has(agent.providerTargetId)
    })
  }, [agents, enableAgents, enabledProviderTargetIds, readRuntimeProviderBinding, runtimeOptionKinds])
  const scopedSelectableAgents = useMemo(
    () => effectiveManualAgentRuntimeKind
      ? selectableAgents.filter(agent => agent.runtimeKind === effectiveManualAgentRuntimeKind)
      : selectableAgents,
    [effectiveManualAgentRuntimeKind, selectableAgents],
  )
  const candidateNewChatAgent = useMemo(() => {
    if (!enableAgents) {
      return null
    }
    const candidateAgentId = effectiveManualAgentId !== undefined ? effectiveManualAgentId : lastAgentId
    if (!candidateAgentId) {
      return null
    }
    return scopedSelectableAgents.find(agent => agent.id === candidateAgentId) ?? null
  }, [enableAgents, effectiveManualAgentId, lastAgentId, scopedSelectableAgents])
  const targetMode = useMemo<ComposerTargetMode>(() => {
    if (context === 'chat') {
      return boundAgentId ? 'agent' : 'provider'
    }
    if (!enableAgents) {
      return 'provider'
    }
    return effectiveManualTargetMode ?? 'provider'
  }, [boundAgentId, context, effectiveManualTargetMode, enableAgents])
  const selectedNewChatAgent = targetMode === 'agent'
    ? candidateNewChatAgent ?? scopedSelectableAgents[0] ?? null
    : null

  const boundAgent = useMemo(() => {
    if (context !== 'chat' || !boundAgentId) {
      return null
    }
    return agents.find(agent => agent.id === boundAgentId && agent.enabled) ?? null
  }, [agents, boundAgentId, context])

  const runtimeKind = useMemo(() => {
    if (context === 'chat') {
      return boundRuntimeKind ?? 'codex'
    }
    if (selectedNewChatAgent) {
      return selectedNewChatAgent.runtimeKind
    }
    if (targetMode === 'agent' && effectiveManualAgentRuntimeKind) {
      return effectiveManualAgentRuntimeKind
    }
    const candidate = effectiveManualRuntimeKind ?? lastRuntimeKind ?? directFallbackRuntimeKind
    return directRuntimeOptions.some(option => option.value === candidate) ? candidate : directFallbackRuntimeKind
  }, [context, boundRuntimeKind, targetMode, effectiveManualAgentRuntimeKind, effectiveManualRuntimeKind, lastRuntimeKind, directRuntimeOptions, directFallbackRuntimeKind, selectedNewChatAgent])
  const providerBinding = readRuntimeProviderBinding(runtimeKind)
  const usesRuntimeOwnedProviderTargets = providerBinding === 'runtime-owned' && runtimeKind !== 'cli-tui'
  const {
    providerOptions,
    isLoading: isLoadingScopedProviders,
  } = useProviderTargets(usesRuntimeOwnedProviderTargets ? { runtimeKind, workspaceId } : undefined)
  const selectableProfiles = useMemo(
    () => listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes }),
    [providerOptions, runtimeKind, runtimes],
  )

  const selectedAgentThinkingEffort = selectedNewChatAgent
    ? readChatThinkingEffort(selectedNewChatAgent.thinkingEffort)
    : null
  const boundSessionThinkingEffort = context === 'chat'
    ? readChatThinkingEffort(boundThinkingEffort)
    : null
  const boundAgentThinkingEffort = context === 'chat'
    ? readChatThinkingEffort(boundAgent?.thinkingEffort)
    : null
  const thinkingEffort = effectiveManualThinkingEffort === undefined
    ? boundSessionThinkingEffort ?? boundAgentThinkingEffort ?? selectedAgentThinkingEffort ?? readChatThinkingEffort(lastThinkingEffort)
    : effectiveManualThinkingEffort
  const usesBoundSessionThinkingEffort = effectiveManualThinkingEffort === undefined && boundSessionThinkingEffort !== null

  const agentId = useMemo(() => {
    if (context === 'chat' && boundAgent?.runtimeKind === runtimeKind) {
      return boundAgent.id
    }
    if (context !== 'chat') {
      return selectedNewChatAgent?.id ?? null
    }
    return null
  }, [runtimeKind, context, boundAgent, selectedNewChatAgent])

  // Resolve effective profile
  const profileId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (context !== 'chat' && targetMode === 'agent' && !selectedNewChatAgent) {
      return null
    }
    if (selectedNewChatAgent?.providerTargetId) {
      return selectedNewChatAgent.providerTargetId
    }
    if (effectiveManualProfileId && selectableProfiles.some(p => p.id === effectiveManualProfileId)) {
      return effectiveManualProfileId
    }
    if (context === 'chat' && boundAgent?.providerTargetId) {
      return boundAgent.providerTargetId
    }
    if (context === 'chat') {
      return boundProviderTargetId ?? pickComposerProfileId({ profiles: selectableProfiles, lastProfileId })
    }
    return pickComposerProfileId({ profiles: selectableProfiles, lastProfileId })
  }, [runtimeKind, context, targetMode, selectedNewChatAgent, effectiveManualProfileId, boundAgent, boundProviderTargetId, lastProfileId, selectableProfiles])

  const initialModelProfileIds = useMemo(() => [profileId], [profileId])
  const {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    successfulProviderTargetIds,
    requestProviderTargetModels,
  } = useProviderTargetModelMap(selectableProfiles, initialModelProfileIds, { workspaceId })
  const modelsByProfileId = modelsByProviderTargetId
  const loadingProfileIds = loadingProviderTargetIds
  const successfulProfileIds = successfulProviderTargetIds
  const requestProfileModels = requestProviderTargetModels
  const models = profileId ? modelsByProfileId[profileId] ?? EMPTY_MODELS : EMPTY_MODELS
  const isLoadingModels = profileId ? loadingProfileIds.has(profileId) : false

  // Resolve effective model
  const modelId = useMemo(() => {
    if (runtimeKind === 'cli-tui') {
      return null
    }
    if (context !== 'chat' && targetMode === 'agent' && !selectedNewChatAgent) {
      return null
    }
    if (effectiveManualModelId && models.some(m => m.id === effectiveManualModelId)) {
      return effectiveManualModelId
    }
    if (selectedNewChatAgent?.modelId) {
      return selectedNewChatAgent.modelId
    }
    if (context === 'chat') {
      return resolveChatModelId({
        boundAgentModelId: boundAgent?.modelId,
        boundAgentProviderTargetId: boundAgent?.providerTargetId,
        boundModelId,
        boundProviderTargetId,
        manualProfileId: effectiveManualProfileId,
        models,
      })
    }
    const persisted = profileId ? lastModelByProfile[profileId] : undefined
    if (persisted && models.some(m => m.id === persisted)) {
      return persisted
    }
    return models[0]?.id ?? null
  }, [runtimeKind, context, targetMode, selectedNewChatAgent, effectiveManualModelId, models, boundModelId, boundAgent, effectiveManualProfileId, boundProviderTargetId, profileId, lastModelByProfile])

  const effectiveAgent = useMemo(
    () => boundAgent?.id === agentId
      ? boundAgent
      : selectedNewChatAgent?.id === agentId
        ? selectedNewChatAgent
        : null,
    [boundAgent, selectedNewChatAgent, agentId],
  )

  // Resolved objects
  const effectiveProfile = useMemo(
    () => selectableProfiles.find(p => p.id === profileId) ?? null,
    [selectableProfiles, profileId],
  )
  const effectiveModel = useMemo(
    () => models.find(m => m.id === modelId) ?? null,
    [models, modelId],
  )
  const effectiveThinkingEffort = useMemo((): ThinkingEffort => {
    return selectChatThinkingEffort({
      effectiveModel,
      preferredThinkingEffort: thinkingEffort,
      preservePreferredThinkingEffort: usesBoundSessionThinkingEffort,
      runtimeKind,
    })
  }, [effectiveModel, thinkingEffort, runtimeKind, usesBoundSessionThinkingEffort])

  const selection = useMemo((): ComposerSelection => ({
    agentId,
    profileId,
    modelId,
    thinkingEffort: runtimeKind === 'cli-tui' ? null : effectiveThinkingEffort,
    runtimeKind,
    targetMode,
  }), [agentId, profileId, modelId, effectiveThinkingEffort, runtimeKind, targetMode])

  const clearSelectedAgent = () => {
    setManualSelectionResetKey(resetKey)
    setManualAgentId(null)
    setLastAgentId(null)
    setManualAgentRuntimeKind(null)
    setManualTargetMode('provider')
    if (runtimeKind === 'cli-tui') {
      setManualRuntimeKind(directFallbackRuntimeKind)
      setLastRuntimeKind(directFallbackRuntimeKind)
    }
  }

  const setAgentId = (id: string | null) => {
    if (!id) {
      clearSelectedAgent()
      return
    }
    const agent = selectableAgents.find(candidate => candidate.id === id)
    if (!agent) {
      return
    }
    setManualSelectionResetKey(resetKey)
    setManualAgentId(agent.id)
    setManualTargetMode('agent')
    setLastAgentId(agent.id)
    setManualRuntimeKind(null)
    setManualAgentRuntimeKind(agent.runtimeKind === 'cli-tui' ? 'cli-tui' : null)
    setLastRuntimeKind(agent.runtimeKind)
    setManualProfileId(null)
    setManualModelId(null)
    setManualThinkingEffort(undefined)
  }

  const setProfileId = (id: string) => {
    if (!selectableProfiles.some(profile => profile.id === id)) {
      return
    }
    setManualSelectionResetKey(resetKey)
    if (selectedNewChatAgent && selectedNewChatAgent.providerTargetId !== id) {
      setManualAgentId(null)
      setLastAgentId(null)
    }
    setManualAgentRuntimeKind(null)
    setManualTargetMode('provider')
    setManualProfileId(id)
    if (context !== 'chat') {
      setLastProfileId(id)
    }
    setManualModelId(null) // reset manual model when profile changes
  }

  const setModelId = (id: string | null, nextProfileId?: string | null) => {
    const targetProfileId = nextProfileId ?? profileId
    if (!targetProfileId) {
      return
    }
    if (!selectableProfiles.some(profile => profile.id === targetProfileId)) {
      return
    }
    setManualSelectionResetKey(resetKey)
    if (selectedNewChatAgent && selectedNewChatAgent.providerTargetId !== targetProfileId) {
      setManualAgentId(null)
      setLastAgentId(null)
    }
    setManualAgentRuntimeKind(null)
    setManualTargetMode('provider')
    if (targetProfileId !== profileId) {
      setManualProfileId(targetProfileId)
    }
    if (context !== 'chat' && targetProfileId !== profileId) {
      setLastProfileId(targetProfileId)
    }
    setManualModelId(id)
    setLastModelForProfile(targetProfileId, id)
  }

  const setThinkingEffort = (effort: ThinkingEffort) => {
    setManualSelectionResetKey(resetKey)
    setManualThinkingEffort(effort)
    setLastThinkingEffort(effort)
  }

  const setRuntimeKind = (kind: RuntimeKind) => {
    if (context === 'chat') {
      return
    }
    setManualSelectionResetKey(resetKey)
    if (kind === 'cli-tui') {
      if (!enableAgents) {
        return
      }
      if (selectedNewChatAgent && selectedNewChatAgent.runtimeKind !== 'cli-tui') {
        setManualAgentId(null)
        setLastAgentId(null)
      }
      setManualTargetMode('agent')
      setManualAgentRuntimeKind('cli-tui')
      setManualRuntimeKind(null)
      setLastRuntimeKind(kind)
      return
    }
    if (selectedNewChatAgent && selectedNewChatAgent.runtimeKind !== kind) {
      setManualAgentId(null)
      setLastAgentId(null)
    }
    setManualAgentRuntimeKind(null)
    setManualTargetMode('provider')
    setManualRuntimeKind(kind)
    setLastRuntimeKind(kind)
  }

  const setTargetMode = (mode: ComposerTargetMode) => {
    if (context === 'chat' || !enableAgents) {
      return
    }
    setManualSelectionResetKey(resetKey)
    setManualTargetMode(mode)
    if (mode === 'provider') {
      setManualAgentId(null)
      setLastAgentId(null)
      setManualAgentRuntimeKind(null)
      if (runtimeKind === 'cli-tui') {
        setManualRuntimeKind(directFallbackRuntimeKind)
        setLastRuntimeKind(directFallbackRuntimeKind)
      }
    }
    else {
      setManualAgentRuntimeKind(null)
    }
  }

  return {
    selection,
    providerBinding,
    setAgentId,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind,
    setTargetMode,
    resetManualSelection,
    runtimeOptions,
    agents: scopedSelectableAgents,
    profiles: selectableProfiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    successfulProfileIds,
    requestProfileModels,
    agentSelectionEnabled: enableAgents,
    isLoadingAgents,
    isLoadingModels,
    isLoadingProfiles: isLoadingBaseProviders || isLoadingScopedProviders,
    effectiveAgent,
    effectiveProfile,
    effectiveModel,
  }
}
