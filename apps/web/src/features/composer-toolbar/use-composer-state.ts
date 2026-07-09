import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { useRemoteProviderTargets } from '~/features/agent-runtime/use-remote-provider-targets'
import type { RuntimeCatalogComposer } from '~/features/agent-runtime/use-runtime-catalog'
import {
  DEFAULT_RUNTIME_CATALOG_COMPOSER,
  listRuntimeCatalogForSurface,
  runtimeComposerSupportsThinking,
  runtimeComposerUsesCollapsedInput,
  runtimeComposerUsesModelSelection,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import { useNewChatStore } from '~/store/new-chat'

import { listSelectableComposerProfiles } from './composer-profile-selection'
import type { RuntimeKindOption } from './constants'
import { selectChatThinkingEffort } from './resolution/chat-selection'
import {
  readComposerThinkingEffort,
  resolveComposerCatalogSource,
  resolveComposerModelId,
  resolveComposerProfileId,
  resolvePreferredThinkingEffort,
} from './resolution/composer-selection'
import { readFallbackRuntimeKind, resolveComposerRuntimeKind } from './resolution/runtime-selection'
import type { ComposerContext, ComposerSelection, ComposerTargetMode, ModelsByProfileId, ProviderModelOption, RuntimeProviderBinding, ThinkingEffort } from './types'

interface ComposerStateConfig {
  context: ComposerContext
  workspaceId?: string | null
  /**
   * When set, provider/model catalogs are loaded from the remote host via the
   * Upstream Gateway instead of local `/provider-targets`.
   */
  remoteHostId?: string | null
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
  runtimeComposer: RuntimeCatalogComposer
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

export function useComposerState(config: ComposerStateConfig): ComposerStateResult {
  const {
    context,
    workspaceId,
    remoteHostId = null,
    enableAgents = false,
    boundAgentId,
    boundProviderTargetId,
    boundModelId,
    boundThinkingEffort,
    boundRuntimeKind,
    resetKey,
  } = config
  const usesRemoteCatalog = resolveComposerCatalogSource(remoteHostId) === 'remote-host'

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

  // Data — remote execution uses the remote host catalog; local stays on /provider-targets.
  const { agents, isLoading: isLoadingAgents } = useAgents()
  const {
    providerOptions: localBaseProviderOptions,
    isLoading: isLoadingLocalBaseProviders,
  } = useProviderTargets()
  const {
    providerOptions: remoteBaseProviderOptions,
    isLoading: isLoadingRemoteBaseProviders,
  } = useRemoteProviderTargets({
    hostId: remoteHostId,
    enabled: usesRemoteCatalog,
  })
  const baseProviderOptions = usesRemoteCatalog ? remoteBaseProviderOptions : localBaseProviderOptions
  const isLoadingBaseProviders = usesRemoteCatalog
    ? isLoadingRemoteBaseProviders
    : isLoadingLocalBaseProviders
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
      icon: runtime.icon,
      degradations: runtime.degradations,
    })),
    [runtimes],
  )
  const runtimeOptionKinds = useMemo(
    () => new Set(runtimeOptions.map(option => option.value)),
    [runtimeOptions],
  )
  const runtimeComposerByKind = useMemo(() => {
    const composers = new Map<RuntimeKind, RuntimeCatalogComposer>()
    for (const runtime of runtimes) {
      composers.set(runtime.runtimeKind, runtime.composer)
    }
    return composers
  }, [runtimes])
  const readRuntimeComposer = useCallback(
    (kind: RuntimeKind): RuntimeCatalogComposer =>
      runtimeComposerByKind.get(kind) ?? DEFAULT_RUNTIME_CATALOG_COMPOSER,
    [runtimeComposerByKind],
  )
  const directRuntimeOptions = useMemo(
    () => runtimeOptions.filter(option => runtimeComposerUsesModelSelection(readRuntimeComposer(option.value))),
    [readRuntimeComposer, runtimeOptions],
  )
  const fallbackRuntimeKind = readFallbackRuntimeKind({ directRuntimeOptions, runtimeOptions })
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
      const agentRuntimeComposer = readRuntimeComposer(agent.runtimeKind)
      if (!runtimeComposerUsesModelSelection(agentRuntimeComposer) || readRuntimeProviderBinding(agent.runtimeKind) === 'runtime-owned') {
        return true
      }
      return !!agent.providerTargetId && enabledProviderTargetIds.has(agent.providerTargetId)
    })
  }, [agents, enableAgents, enabledProviderTargetIds, readRuntimeComposer, readRuntimeProviderBinding, runtimeOptionKinds])
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

  const runtimeKind = useMemo(() => resolveComposerRuntimeKind({
    context,
    boundRuntimeKind,
    selectedAgentRuntimeKind: selectedNewChatAgent?.runtimeKind ?? null,
    targetMode,
    manualAgentRuntimeKind: effectiveManualAgentRuntimeKind,
    manualRuntimeKind: effectiveManualRuntimeKind,
    lastRuntimeKind,
    directRuntimeOptions,
    fallbackRuntimeKind,
  }), [
    boundRuntimeKind,
    context,
    directRuntimeOptions,
    effectiveManualAgentRuntimeKind,
    effectiveManualRuntimeKind,
    fallbackRuntimeKind,
    lastRuntimeKind,
    selectedNewChatAgent?.runtimeKind,
    targetMode,
  ])
  const providerBinding = readRuntimeProviderBinding(runtimeKind)
  const runtimeComposer = readRuntimeComposer(runtimeKind)
  const composerUsesModelSelection = runtimeComposerUsesModelSelection(runtimeComposer)
  const usesRuntimeOwnedProviderTargets = providerBinding === 'runtime-owned' && composerUsesModelSelection
  const scopedProviderQuery = usesRuntimeOwnedProviderTargets
    ? { runtimeKind, workspaceId }
    : undefined
  const {
    providerOptions: localScopedProviderOptions,
    isLoading: isLoadingLocalScopedProviders,
  } = useProviderTargets(usesRemoteCatalog ? undefined : scopedProviderQuery)
  const {
    providerOptions: remoteScopedProviderOptions,
    isLoading: isLoadingRemoteScopedProviders,
  } = useRemoteProviderTargets({
    hostId: remoteHostId,
    enabled: usesRemoteCatalog && usesRuntimeOwnedProviderTargets,
    runtimeKind,
    workspaceId,
  })
  const providerOptions = usesRuntimeOwnedProviderTargets
    ? (usesRemoteCatalog ? remoteScopedProviderOptions : localScopedProviderOptions)
    : baseProviderOptions
  const isLoadingScopedProviders = usesRuntimeOwnedProviderTargets
    ? (usesRemoteCatalog ? isLoadingRemoteScopedProviders : isLoadingLocalScopedProviders)
    : isLoadingBaseProviders
  const selectableProfiles = useMemo(
    () => listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes }),
    [providerOptions, runtimeKind, runtimes],
  )

  const selectedAgentThinkingEffort = selectedNewChatAgent
    ? readComposerThinkingEffort(selectedNewChatAgent.thinkingEffort)
    : null
  const boundSessionThinkingEffort = context === 'chat'
    ? readComposerThinkingEffort(boundThinkingEffort)
    : null
  const boundAgentThinkingEffort = context === 'chat'
    ? readComposerThinkingEffort(boundAgent?.thinkingEffort)
    : null
  const {
    thinkingEffort,
    usesBoundSessionThinkingEffort,
  } = resolvePreferredThinkingEffort({
    manualThinkingEffort: effectiveManualThinkingEffort,
    boundSessionThinkingEffort,
    boundAgentThinkingEffort,
    selectedAgentThinkingEffort,
    lastThinkingEffort: readComposerThinkingEffort(lastThinkingEffort),
  })

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
    return resolveComposerProfileId({
      composerUsesModelSelection,
      context,
      targetMode,
      selectedAgentId: selectedNewChatAgent?.id ?? null,
      selectedAgentProviderTargetId: selectedNewChatAgent?.providerTargetId,
      manualProfileId: effectiveManualProfileId,
      boundAgentProviderTargetId: boundAgent?.providerTargetId,
      boundProviderTargetId,
      boundModelId,
      providerBinding,
      lastProfileId,
      selectableProfiles,
    })
  }, [composerUsesModelSelection, context, targetMode, selectedNewChatAgent, effectiveManualProfileId, boundAgent, boundProviderTargetId, boundModelId, providerBinding, lastProfileId, selectableProfiles])

  const initialModelProfileIds = useMemo(() => [profileId], [profileId])
  const {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    successfulProviderTargetIds,
    requestProviderTargetModels,
  } = useProviderTargetModelMap(selectableProfiles, initialModelProfileIds, {
    workspaceId,
    hostId: remoteHostId,
  })
  const modelsByProfileId = modelsByProviderTargetId
  const loadingProfileIds = loadingProviderTargetIds
  const successfulProfileIds = successfulProviderTargetIds
  const requestProfileModels = requestProviderTargetModels
  const models = profileId ? modelsByProfileId[profileId] ?? EMPTY_MODELS : EMPTY_MODELS
  const isLoadingModels = profileId ? loadingProfileIds.has(profileId) : false

  // Resolve effective model
  const modelId = useMemo(() => {
    return resolveComposerModelId({
      composerUsesModelSelection,
      context,
      targetMode,
      selectedAgentId: selectedNewChatAgent?.id ?? null,
      selectedAgentModelId: selectedNewChatAgent?.modelId,
      manualModelId: effectiveManualModelId,
      models,
      boundAgentModelId: boundAgent?.modelId,
      boundAgentProviderTargetId: boundAgent?.providerTargetId,
      boundModelId,
      boundProviderTargetId,
      manualProfileId: effectiveManualProfileId,
      profileId,
      lastModelByProfile,
    })
  }, [composerUsesModelSelection, context, targetMode, selectedNewChatAgent, effectiveManualModelId, models, boundModelId, boundAgent, effectiveManualProfileId, boundProviderTargetId, profileId, lastModelByProfile])

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
      runtimeComposer,
    })
  }, [effectiveModel, thinkingEffort, runtimeComposer, usesBoundSessionThinkingEffort])

  const selection = useMemo((): ComposerSelection => ({
    agentId,
    profileId,
    modelId,
    thinkingEffort: runtimeComposerSupportsThinking(runtimeComposer) ? effectiveThinkingEffort : null,
    runtimeKind,
    targetMode,
  }), [agentId, profileId, modelId, effectiveThinkingEffort, runtimeComposer, runtimeKind, targetMode])

  const clearSelectedAgent = () => {
    setManualSelectionResetKey(resetKey)
    setManualAgentId(null)
    setLastAgentId(null)
    setManualAgentRuntimeKind(null)
    setManualTargetMode('provider')
    if (runtimeComposerUsesCollapsedInput(runtimeComposer)) {
      setManualRuntimeKind(fallbackRuntimeKind)
      setLastRuntimeKind(fallbackRuntimeKind)
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
    setManualAgentRuntimeKind(runtimeComposerUsesModelSelection(readRuntimeComposer(agent.runtimeKind)) ? null : agent.runtimeKind)
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
    const nextRuntimeComposer = readRuntimeComposer(kind)
    if (!runtimeComposerUsesModelSelection(nextRuntimeComposer)) {
      if (!enableAgents) {
        return
      }
      if (selectedNewChatAgent && selectedNewChatAgent.runtimeKind !== kind) {
        setManualAgentId(null)
        setLastAgentId(null)
      }
      setManualTargetMode('agent')
      setManualAgentRuntimeKind(kind)
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
      if (!runtimeComposerUsesModelSelection(runtimeComposer)) {
        setManualRuntimeKind(fallbackRuntimeKind)
        setLastRuntimeKind(fallbackRuntimeKind)
      }
    }
    else {
      setManualAgentRuntimeKind(null)
    }
  }

  return {
    selection,
    providerBinding,
    runtimeComposer,
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
