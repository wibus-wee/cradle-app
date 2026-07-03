import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { listRuntimeCatalogForSurface, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { listSelectableComposerProfiles } from '~/features/composer-toolbar/composer-profile-selection'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue } from '~/features/composer-toolbar/constants'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { RuntimeSelector } from '~/features/composer-toolbar/runtime-selector'
import type { JarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'
import { useJarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

const JARVIS_THINKING_LEVELS: Array<JarvisPreferences['thinkingLevel']> = ['minimal', 'low', 'medium', 'high', 'xhigh']

type SettingsKey = keyof typeof import('~/locales/default').default.settings
type PendingSelection = { runtimeKind: string, profileId: string }

const jarvisThinkingLabelKeys = {
  minimal: 'jarvis.thinking.minimal.label',
  low: 'jarvis.thinking.low.label',
  medium: 'jarvis.thinking.medium.label',
  high: 'jarvis.thinking.high.label',
  xhigh: 'jarvis.thinking.xhigh.label',
} satisfies Record<JarvisPreferences['thinkingLevel'], SettingsKey>

const jarvisThinkingDescriptionKeys = {
  minimal: 'jarvis.thinking.minimal.description',
  low: 'jarvis.thinking.low.description',
  medium: 'jarvis.thinking.medium.description',
  high: 'jarvis.thinking.high.description',
  xhigh: 'jarvis.thinking.xhigh.description',
} satisfies Record<JarvisPreferences['thinkingLevel'], SettingsKey>

export function JarvisSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isSuccess: prefsReady, isSaving: saving, savePrefs: save } = useJarvisPreferences()
  const { providerOptions, isSuccess: providerTargetsReady } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null)
  const runtimeKind = pendingSelection?.runtimeKind ?? prefs?.runtimeKind ?? 'jar-core'
  const runtimeOptions = listRuntimeCatalogForSurface(runtimes, 'jarvis').map(runtime => ({
    value: runtime.runtimeKind,
    label: runtime.label,
    description: runtime.description,
    icon: runtime.icon,
  }))
  const profiles = listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes })
  const selectedProviderTarget = profiles.find(profile => profile.id === (pendingSelection?.profileId ?? prefs?.profileId)) ?? null
  const initialModelProfileIds = useMemo(
    () => [pendingSelection?.profileId ?? prefs?.profileId ?? null],
    [pendingSelection?.profileId, prefs?.profileId],
  )
  const {
    modelsByProviderTargetId: modelsByProfileId,
    loadingProviderTargetIds: loadingProfileIds,
    successfulProviderTargetIds: successfulProfileIds,
    requestProviderTargetModels: requestProfileModels,
  } = useProviderTargetModelMap(
    profiles,
    initialModelProfileIds,
  )
  const selectedProviderTargetId = selectedProviderTarget?.id ?? null
  const selectedModels = useMemo(
    () => selectedProviderTargetId ? modelsByProfileId[selectedProviderTargetId] ?? [] : [],
    [modelsByProfileId, selectedProviderTargetId],
  )
  const selectedModel = pendingSelection ? null : selectedModels.find(model => model.id === prefs?.model) ?? null
  const selectedProviderTargetModelsReady = !selectedProviderTarget
    || !selectedProviderTarget.enabled
    || successfulProfileIds.has(selectedProviderTarget.id)
  const settingsJarvisReady = prefsReady && providerTargetsReady && !pendingSelection && selectedProviderTargetModelsReady
  const thinkingOptions = useMemo<Array<ThinkingOption<JarvisPreferences['thinkingLevel']>>>(() =>
    JARVIS_THINKING_LEVELS.map(value => ({
      value,
      label: t(jarvisThinkingLabelKeys[value]),
      description: t(jarvisThinkingDescriptionKeys[value]),
    })), [t])
  const selectThinkingForModel = useCallback((model: typeof selectedModel): JarvisPreferences['thinkingLevel'] =>
    selectSupportedThinkingValue(model, thinkingOptions, prefs?.thinkingLevel ?? 'medium', 'medium'), [prefs?.thinkingLevel, thinkingOptions])
  const completePendingSelection = useCallback((selection: PendingSelection, patch: Partial<JarvisPreferences>) => {
    void save(patch).then(
      () => {
        setPendingSelection(current => current?.runtimeKind === selection.runtimeKind && current.profileId === selection.profileId
          ? null
          : current)
      },
      () => {
        setPendingSelection(current => current?.runtimeKind === selection.runtimeKind && current.profileId === selection.profileId
          ? null
          : current)
      },
    )
  }, [save])

  useEffect(() => {
    if (!pendingSelection || saving) {
      return
    }
    if (!profiles.some(profile => profile.id === pendingSelection.profileId)) {
      setPendingSelection(null)
      return
    }
    const nextModel = selectedModels[0] ?? null
    if (!nextModel) {
      if (successfulProfileIds.has(pendingSelection.profileId)) {
        completePendingSelection(pendingSelection, {
          runtimeKind: pendingSelection.runtimeKind,
          profileId: pendingSelection.profileId,
          model: undefined,
        })
      }
      return
    }
    completePendingSelection(pendingSelection, {
      runtimeKind: pendingSelection.runtimeKind,
      profileId: pendingSelection.profileId,
      model: nextModel.id,
      thinkingLevel: selectThinkingForModel(nextModel),
    })
  }, [completePendingSelection, pendingSelection, profiles, saving, selectThinkingForModel, selectedModels, successfulProfileIds])

  useEffect(() => {
    if (pendingSelection || !prefs || !prefs.profileId || prefs.model || selectedModels.length === 0 || saving) {
      return
    }
    const nextModel = selectedModels[0]!
    void save({ model: nextModel.id, thinkingLevel: selectThinkingForModel(nextModel) })
  }, [pendingSelection, prefs, save, saving, selectThinkingForModel, selectedModels])

  if (!prefs) {
    return null
  }

  return (
    <SettingsPage
      title={t('jarvis.page.title')}
      description={t('jarvis.page.description')}
      data-testid="jarvis-settings"
      data-settings-jarvis-ready={settingsJarvisReady ? 'true' : 'false'}
    >
      <SettingsGroup>
        <SettingsRow label={t('jarvis.runtime.label')} description={t('jarvis.runtime.description')}>
          <RuntimeSelector
            value={runtimeKind}
            onChange={(nextRuntimeKind) => {
              const nextProfiles = listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind: nextRuntimeKind, runtimes })
              const currentProfileStillValid = prefs.profileId
                ? nextProfiles.some(profile => profile.id === prefs.profileId)
                : false
              const nextProfile = currentProfileStillValid
                ? nextProfiles.find(profile => profile.id === prefs.profileId) ?? null
                : nextProfiles[0] ?? null
              if (!nextProfile) {
                setPendingSelection(null)
                void save({ runtimeKind: nextRuntimeKind, profileId: null, model: undefined })
                return
              }
              requestProfileModels(nextProfile.id)
              const nextModel = (modelsByProfileId[nextProfile.id] ?? [])[0] ?? null
              if (!nextModel) {
                setPendingSelection({ runtimeKind: nextRuntimeKind, profileId: nextProfile.id })
                return
              }
              setPendingSelection(null)
              void save({
                runtimeKind: nextRuntimeKind,
                profileId: nextProfile.id,
                model: nextModel.id,
                thinkingLevel: selectThinkingForModel(nextModel),
              })
            }}
            options={runtimeOptions}
            disabled={saving}
          />
        </SettingsRow>

        <SettingsRow label={t('jarvis.model.label')} description={t('jarvis.model.description')}>
          <ProviderModelPicker
            providerTargets={profiles}
            selectedProviderTargetId={pendingSelection?.profileId ?? prefs.profileId}
            selectedModelId={pendingSelection ? null : prefs.model ?? null}
            selectedModel={selectedModel}
            modelsByProviderTargetId={modelsByProfileId}
            loadingProviderTargetIds={loadingProfileIds}
            isLoadingSelectedModels={Boolean(pendingSelection && loadingProfileIds.has(pendingSelection.profileId))}
            thinkingValue={prefs.thinkingLevel}
            thinkingOptions={thinkingOptions}
            emptyProviderTargetsLabel={t('jarvis.model.emptyProfiles')}
            emptySelectionLabel={t('jarvis.model.emptySelection')}
            menuSide="bottom"
            menuAlign="end"
            triggerTestId="jarvis-provider-model-selector"
            disabled={saving}
            getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, thinkingOptions)}
            onRequestProviderTargetModels={requestProfileModels}
            onSelectProviderTarget={(profileId) => {
              requestProfileModels(profileId)
              const nextModel = (modelsByProfileId[profileId] ?? [])[0] ?? null
              if (!nextModel) {
                setPendingSelection({ runtimeKind, profileId })
                return
              }
              setPendingSelection(null)
              void save({ profileId, model: nextModel.id, thinkingLevel: selectThinkingForModel(nextModel) })
            }}
            onSelectModel={(model, profileId) => {
              if (!model) {
                return
              }
              const nextModel = (modelsByProfileId[profileId] ?? []).find(item => item.id === model) ?? null
              setPendingSelection(null)
              void save({ profileId, model, thinkingLevel: selectThinkingForModel(nextModel) })
            }}
            onSelectThinking={thinkingLevel => void save({ thinkingLevel })}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
