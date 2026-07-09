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
  none: 'thinking.none.label',
  minimal: 'thinking.minimal.label',
  low: 'thinking.low.label',
  medium: 'thinking.medium.label',
  high: 'thinking.high.label',
  xhigh: 'thinking.xhigh.label',
  max: 'thinking.max.label',
} satisfies Record<ThinkingOptionKey, CommonKey>

const thinkingDescriptionKeys = {
  none: 'thinking.none.description',
  minimal: 'thinking.minimal.description',
  low: 'thinking.low.description',
  medium: 'thinking.medium.description',
  high: 'thinking.high.description',
  xhigh: 'thinking.xhigh.description',
  max: 'thinking.max.description',
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
