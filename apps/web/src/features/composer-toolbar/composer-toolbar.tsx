import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { RuntimeCatalogComposer } from '~/features/agent-runtime/use-runtime-catalog'
import {
  runtimeComposerSupportsThinking,
  runtimeComposerUsesAliasMatrixModelSelection,
  runtimeComposerUsesModelSelection,
} from '~/features/agent-runtime/use-runtime-catalog'
import type { ClaudeAgentModelAliasesSlot } from '~/features/chat/runtime/claude-session-model-matrix-control'

import { AgentSelector } from './agent-selector'
import { ChatAgentIdentity } from './chat-agent-identity'
import { filterThinkingOptionsForModel } from './constants'
import type { ThinkingOption } from './provider-model-menu'
import { ProviderModelSelector, useProviderThinkingOptions } from './provider-model-selector'
import { RuntimeSelector } from './runtime-selector'
import { ThinkingEffortButton } from './thinking-effort-button'
import type { ComposerContext, ThinkingEffort } from './types'
import type { ComposerStateResult } from './use-composer-state'

const AGENTS_RUNTIME_SELECTOR_VALUE = 'agents'

function includeSelectedThinkingOption(
  options: Array<ThinkingOption<ThinkingEffort>>,
  allOptions: Array<ThinkingOption<ThinkingEffort>>,
  selected: ThinkingEffort,
): Array<ThinkingOption<ThinkingEffort>> {
  if (selected === null || options.some(option => option.value === selected)) {
    return options
  }

  const optionValues = new Set(options.map(option => option.value))
  optionValues.add(selected)
  return allOptions.filter(option => optionValues.has(option.value))
}

function filterThinkingOptionsForRuntimeComposer(
  composer: RuntimeCatalogComposer,
  options: Array<ThinkingOption<ThinkingEffort>>,
): Array<ThinkingOption<ThinkingEffort>> {
  if (typeof composer.thinking !== 'object') {
    return options
  }
  const efforts = new Set(composer.thinking.efforts)
  return options.filter(option => option.value !== null && efforts.has(option.value))
}

interface ComposerToolbarProps {
  context: ComposerContext
  state: ComposerStateResult
  claudeModelAliases?: { slot: ClaudeAgentModelAliasesSlot, providerSettingsLoading?: boolean } | null
}

export function ComposerToolbar({ context, state, claudeModelAliases }: ComposerToolbarProps) {
  const {
    selection,
    setAgentId,
    setProfileId,
    setModelId,
    setThinkingEffort,
    setRuntimeKind,
    setTargetMode,
    runtimeOptions,
    agents,
    profiles,
    models,
    modelsByProfileId,
    loadingProfileIds,
    requestProfileModels,
    isLoadingModels,
  } = state
  const { t } = useTranslation('common')
  const boundChatAgent = context === 'chat' ? state.effectiveAgent : null
  const runtimeSelectorOptions = useMemo(() => {
    if (context !== 'new-chat' || !state.agentSelectionEnabled) {
      return runtimeOptions
    }
    return [
      ...runtimeOptions,
      {
        value: AGENTS_RUNTIME_SELECTOR_VALUE,
        label: t('runtime.agents.label'),
        description: t('runtime.agents.description'),
        iconKey: 'agents',
      },
    ]
  }, [context, runtimeOptions, state.agentSelectionEnabled, t])
  const runtimeSelectorValue = context === 'new-chat'
    && selection.targetMode === 'agent'
    && runtimeComposerUsesModelSelection(state.runtimeComposer)
    ? AGENTS_RUNTIME_SELECTOR_VALUE
    : selection.runtimeKind
  const handleRuntimeChange = (kind: RuntimeKind) => {
    if (kind === AGENTS_RUNTIME_SELECTOR_VALUE) {
      setTargetMode('agent')
      return
    }
    setRuntimeKind(kind)
  }

  const thinkingOptions = useProviderThinkingOptions()
  const usesAliasMatrixModelSelection = runtimeComposerUsesAliasMatrixModelSelection(state.runtimeComposer)
  const supportedThinkingControlOptions = usesAliasMatrixModelSelection
    ? filterThinkingOptionsForRuntimeComposer(state.runtimeComposer, thinkingOptions)
    : filterThinkingOptionsForModel(state.effectiveModel, thinkingOptions)
  const thinkingControlOptions = includeSelectedThinkingOption(
    supportedThinkingControlOptions,
    thinkingOptions,
    selection.thinkingEffort,
  )
  const showThinkingControl = runtimeComposerSupportsThinking(state.runtimeComposer) && thinkingControlOptions.length > 0
  const showClaudeModelAliases = selection.targetMode === 'provider'
    && usesAliasMatrixModelSelection
    && !!claudeModelAliases

  const runtimeControl = (
    <RuntimeSelector
      value={runtimeSelectorValue}
      onChange={handleRuntimeChange}
      readOnly={context === 'chat'}
      options={runtimeSelectorOptions}
      occludeNativeBrowserSurface
    />
  )
  const agentIdentity = boundChatAgent ? <ChatAgentIdentity agent={boundChatAgent} /> : null
  const agentSelector = context === 'new-chat' && selection.targetMode === 'agent'
    ? (
        <AgentSelector
          agents={agents}
          selectedAgentId={selection.agentId}
          runtimeOptions={runtimeOptions}
          onSelectAgent={setAgentId}
          occludeNativeBrowserSurface
        />
      )
    : null
  const providerSelector = selection.targetMode === 'provider' && runtimeComposerUsesModelSelection(state.runtimeComposer)
    ? (
        <ProviderModelSelector
          profiles={profiles}
          selectedProfileId={selection.profileId}
          selectedModelId={selection.modelId}
          models={models}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          thinkingEffort={selection.thinkingEffort}
          isLoadingModels={isLoadingModels}
          showThinkingInModelMenu={false}
          claudeModelAliases={showClaudeModelAliases ? claudeModelAliases : null}
          requestProfileModels={requestProfileModels}
          onSelectProfile={setProfileId}
          onSelectModel={setModelId}
          onSelectThinkingEffort={setThinkingEffort}
        />
      )
    : null
  const thinkingControl = showThinkingControl
    ? (
        <ThinkingEffortButton
          thinkingEffort={selection.thinkingEffort}
          thinkingOptions={thinkingControlOptions}
          onSelect={setThinkingEffort}
          occludeNativeBrowserSurface
        />
      )
    : null
  const targetControl = agentIdentity ?? agentSelector ?? providerSelector

  return (
    <div className="flex min-w-0 items-center gap-1">
      {runtimeControl}
      {targetControl}
      {thinkingControl}
    </div>
  )
}
