import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelDescriptor } from '~/features/agent-runtime/types'
import type { ClaudeAgentModelAliasesSlot } from '~/features/chat/runtime/claude-session-model-matrix-control'
import { ClaudeAgentModelAliasesSubmenu } from '~/features/chat/runtime/claude-session-model-matrix-control'

import { filterThinkingOptionsForModel, selectSupportedThinkingValue, THINKING_EFFORTS } from './constants'
import type { ThinkingOption } from './provider-model-menu'
import { ProviderModelPicker } from './provider-model-picker'
import type { ModelsByProfileId, ProviderModelOption, ThinkingEffort } from './types'

type CommonKey = keyof typeof import('~/locales/default').default.common
type ThinkingOptionKey = NonNullable<ThinkingEffort>

const thinkingLabelKeys = {
  low: 'thinking.low.label',
  medium: 'thinking.medium.label',
  high: 'thinking.high.label',
  xhigh: 'thinking.xhigh.label',
} satisfies Record<ThinkingOptionKey, CommonKey>

const thinkingDescriptionKeys = {
  low: 'thinking.low.description',
  medium: 'thinking.medium.description',
  high: 'thinking.high.description',
  xhigh: 'thinking.xhigh.description',
} satisfies Record<ThinkingOptionKey, CommonKey>

interface ProviderModelSelectorProps {
  profiles: ProviderModelOption[]
  selectedProfileId: string | null
  selectedModelId: string | null
  models: ModelDescriptor[]
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  thinkingEffort: ThinkingEffort
  isLoadingModels: boolean
  showThinkingInModelMenu?: boolean
  claudeModelAliases?: { slot: ClaudeAgentModelAliasesSlot, providerSettingsLoading?: boolean } | null
  requestProfileModels: (id: string, options?: { refresh?: boolean }) => void
  onSelectProfile: (id: string) => void
  onSelectModel: (id: string, profileId: string | null) => void
  onSelectThinkingEffort: (effort: ThinkingEffort) => void
}

export function useProviderThinkingOptions(): Array<ThinkingOption<ThinkingEffort>> {
  const { t } = useTranslation('common')
  return THINKING_EFFORTS.map((option) => {
    const key = option.value
    return {
      value: key,
      label: t(thinkingLabelKeys[key]),
      description: t(thinkingDescriptionKeys[key]),
    }
  })
}

export function ProviderModelSelector({
  profiles,
  selectedProfileId,
  selectedModelId,
  models,
  modelsByProfileId,
  loadingProfileIds,
  thinkingEffort,
  isLoadingModels,
  showThinkingInModelMenu = true,
  claudeModelAliases,
  requestProfileModels,
  onSelectProfile,
  onSelectModel,
  onSelectThinkingEffort,
}: ProviderModelSelectorProps) {
  const { t } = useTranslation('common')
  const selectedModel = models.find(model => model.id === selectedModelId) ?? null
  const thinkingOptions = useProviderThinkingOptions()
  const hiddenThinkingOptions: Array<ThinkingOption<ThinkingEffort>> = [{ value: null, label: '', description: '' }]
  const menuThinkingOptions = showThinkingInModelMenu ? thinkingOptions : hiddenThinkingOptions
  const selectThinkingForModel = (model: ModelDescriptor | null): ThinkingEffort =>
      selectSupportedThinkingValue(model, thinkingOptions, thinkingEffort, 'high')

  // Track pending provider selection to auto-select first model after load
  const pendingProviderSelectionRef = useRef<string | null>(null)

  // Auto-select first model when a new provider's models finish loading
  useEffect(() => {
    const pendingProfileId = pendingProviderSelectionRef.current
    if (!pendingProfileId) {
      return
    }

    // Check if this provider's models have finished loading
    const isLoading = loadingProfileIds.has(pendingProfileId)
    if (isLoading) {
      return
    }

    // Clear the pending selection
    pendingProviderSelectionRef.current = null

    // Auto-select the first model if available
    const loadedModels = modelsByProfileId[pendingProfileId] ?? []
    if (loadedModels.length > 0) {
      const firstModel = loadedModels[0]
      onSelectModel(firstModel.id, pendingProfileId)
      if (showThinkingInModelMenu) {
        onSelectThinkingEffort(selectThinkingForModel(firstModel))
      }
    }
  }, [loadingProfileIds, modelsByProfileId, onSelectModel, onSelectThinkingEffort, selectThinkingForModel, showThinkingInModelMenu])

  return (
    <ProviderModelPicker
      providerTargets={profiles}
      selectedProviderTargetId={selectedProfileId}
      selectedModelId={selectedModelId}
      selectedModel={selectedModel}
      modelsByProviderTargetId={modelsByProfileId}
      loadingProviderTargetIds={loadingProfileIds}
      thinkingValue={thinkingEffort}
      thinkingOptions={menuThinkingOptions}
      isLoadingSelectedModels={isLoadingModels}
      emptyProviderTargetsLabel={t('model.noProviderTargets')}
      showProviderLabel
      occludeNativeBrowserSurface
      leadingContent={claudeModelAliases
          ? (
              <ClaudeAgentModelAliasesSubmenu
                models={models}
                selectedModelId={selectedModelId}
                aliases={claudeModelAliases.slot.aliases}
                loading={claudeModelAliases.slot.loading}
                loadingModels={isLoadingModels || claudeModelAliases.providerSettingsLoading}
                onChange={claudeModelAliases.slot.onChange}
                occludeNativeBrowserSurface
              />
            )
          : null}
      getThinkingOptionsForModel={model =>
        showThinkingInModelMenu
          ? filterThinkingOptionsForModel(model, thinkingOptions)
          : hiddenThinkingOptions}
      onRequestProviderTargetModels={requestProfileModels}
      onSelectProviderTarget={(id) => {
        requestProfileModels(id)
        onSelectProfile(id)
        // Mark this provider as pending - will auto-select first model after load
        pendingProviderSelectionRef.current = id
      }}
      onSelectModel={(id, profileId) => {
        if (id) {
          onSelectModel(id, profileId)
          const nextModel = (modelsByProfileId[profileId] ?? []).find(model => model.id === id) ?? null
          if (showThinkingInModelMenu) {
            onSelectThinkingEffort(selectThinkingForModel(nextModel))
          }
        }
      }}
      onSelectThinking={onSelectThinkingEffort}
    />
  )
}
