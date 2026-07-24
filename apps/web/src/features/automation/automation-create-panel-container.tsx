import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { RuntimeSelector } from '~/features/agent-runtime/runtime-selector'
import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import {
  listRuntimeCatalogForSurface,
  runtimeCatalogItemUsesModelSelection,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import {
  listSelectableComposerProfiles,
  pickComposerProfileId,
} from '~/features/composer-toolbar/composer-profile-selection'
import {
  filterThinkingOptionsForModel,
  selectSupportedThinkingValue,
  THINKING_EFFORTS,
} from '~/features/composer-toolbar/constants'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import type { ThinkingEffort } from '~/features/composer-toolbar/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { AutomationCreatePanelView } from './automation-create-panel-view'
import type { CreateAutomationDraft } from './automation-draft'

export interface AutomationCreatePanelContainerProps {
  draft: CreateAutomationDraft
  saving: boolean
  error: string | null
  canSave: boolean
  editingId?: string | null
  onChange: (draft: CreateAutomationDraft) => void
  onCancel: () => void
  onSave: () => void
}

export function AutomationCreatePanelContainer({
  draft,
  saving,
  error,
  canSave,
  editingId,
  onChange,
  onCancel,
  onSave,
}: AutomationCreatePanelContainerProps) {
  const { t } = useTranslation('automation')
  const { workspaces } = useWorkspaces()
  const { providerOptions, isLoading } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()
  const runtimeOptions = useMemo(
    () => listRuntimeCatalogForSurface(runtimes, 'chat')
      .filter(runtimeCatalogItemUsesModelSelection)
      .map(runtime => ({
        value: runtime.runtimeKind,
        label: runtime.label,
        description: runtime.description,
        icon: runtime.icon,
      })),
    [runtimes],
  )
  const selectableProfiles = useMemo(
    () => listSelectableComposerProfiles({
      profiles: providerOptions,
      runtimeKind: draft.runtimeKind,
      runtimes,
    }),
    [draft.runtimeKind, providerOptions, runtimes],
  )
  const selectedProfileId = useMemo(
    () => pickComposerProfileId({
      profiles: selectableProfiles,
      lastProfileId: draft.providerTargetId || null,
    }),
    [draft.providerTargetId, selectableProfiles],
  )
  const initialModelProfileIds = useMemo(
    () => [selectedProfileId],
    [selectedProfileId],
  )
  const {
    modelsByProviderTargetId: modelsByProfileId,
    loadingProviderTargetIds: loadingProfileIds,
    requestProviderTargetModels: requestProfileModels,
  } = useProviderTargetModelMap(
    selectableProfiles,
    initialModelProfileIds,
  )
  const models = useMemo(
    () => selectedProfileId
      ? modelsByProfileId[selectedProfileId] ?? []
      : [],
    [modelsByProfileId, selectedProfileId],
  )
  const selectedModel = models.find(model => model.id === draft.modelId) ?? null
  const selectedModelId = draft.modelId
    && models.some(model => model.id === draft.modelId)
    ? draft.modelId
    : models[0]?.id ?? null
  const isLoadingModels = selectedProfileId
    ? loadingProfileIds.has(selectedProfileId)
    : false
  const thinkingOptions = useMemo(
    () => THINKING_EFFORTS.map(option => ({
      value: option.value,
      label: t(`thinking.${option.value}`),
      description: t('thinking.effortDescription', {
        effort: t(`thinking.${option.value}`),
      }),
    })),
    [t],
  )
  const selectThinkingForModel = useCallback(
    (model: ModelDescriptor | null): ThinkingEffort =>
      selectSupportedThinkingValue(
        model,
        thinkingOptions,
        draft.thinkingEffort,
        null,
      ),
    [draft.thinkingEffort, thinkingOptions],
  )

  useEffect(() => {
    if (!selectedProfileId) {
      if (draft.providerTargetId || draft.modelId) {
        onChange({
          ...draft,
          providerTargetId: '',
          modelId: null,
          thinkingEffort: null,
        })
      }
      return
    }

    if (draft.providerTargetId !== selectedProfileId) {
      onChange({
        ...draft,
        providerTargetId: selectedProfileId,
        modelId: null,
        thinkingEffort: null,
      })
    }
  }, [draft, onChange, selectedProfileId])

  useEffect(() => {
    if (
      !selectedProfileId
      || draft.modelId !== null
      || models.length === 0
    ) {
      return
    }
    const firstModel = models[0]
    onChange({
      ...draft,
      modelId: firstModel.id,
      thinkingEffort: selectThinkingForModel(firstModel),
    })
  }, [
    draft,
    models,
    onChange,
    selectThinkingForModel,
    selectedProfileId,
  ])

  const updateRuntimeKind = useCallback((runtimeKind: RuntimeKind) => {
    const runtime = runtimes.find(item => item.runtimeKind === runtimeKind)
    if (!runtime || !runtimeCatalogItemUsesModelSelection(runtime)) {
      return
    }
    const nextProfiles = listSelectableComposerProfiles({
      profiles: providerOptions,
      runtimeKind,
      runtimes,
    })
    const nextProviderTargetId = pickComposerProfileId({
      profiles: nextProfiles,
      lastProfileId: draft.providerTargetId || null,
    })
    onChange({
      ...draft,
      runtimeKind,
      providerTargetId: nextProviderTargetId ?? '',
      modelId: null,
      thinkingEffort: null,
    })
  }, [draft, onChange, providerOptions, runtimes])

  const updateProviderTarget = useCallback((providerTargetId: string) => {
    requestProfileModels(providerTargetId)
    const nextModel = (modelsByProfileId[providerTargetId] ?? [])[0] ?? null
    onChange({
      ...draft,
      providerTargetId,
      modelId: nextModel?.id ?? null,
      thinkingEffort: nextModel
        ? selectThinkingForModel(nextModel)
        : draft.thinkingEffort,
    })
  }, [
    draft,
    modelsByProfileId,
    onChange,
    requestProfileModels,
    selectThinkingForModel,
  ])

  const updateModel = useCallback((
    modelId: string | null,
    providerTargetId: string,
  ) => {
    if (!modelId) {
      return
    }
    const nextModel = (modelsByProfileId[providerTargetId] ?? [])
      .find(model => model.id === modelId) ?? null
    onChange({
      ...draft,
      providerTargetId,
      modelId,
      thinkingEffort: selectThinkingForModel(nextModel),
    })
  }, [draft, modelsByProfileId, onChange, selectThinkingForModel])

  const updateThinkingEffort = useCallback(
    (thinkingEffort: ThinkingEffort) => {
      onChange({ ...draft, thinkingEffort })
    },
    [draft, onChange],
  )

  const runtimeDescription = isLoading
    ? t('runtime.loadingProviders')
    : selectableProfiles.length === 0
      ? t('runtime.noCompatibleTargets')
      : t('runtime.description')
  const effectiveSelectedModel = selectedModel
    ?? models.find(model => model.id === selectedModelId)
    ?? null
  const resolvedModelReady = Boolean(
    draft.providerTargetId
    && draft.modelId
    && effectiveSelectedModel,
  )

  return (
    <AutomationCreatePanelView
      draft={draft}
      workspaces={workspaces}
      runtimeDescription={runtimeDescription}
      selectedModelLabel={effectiveSelectedModel?.id ?? null}
      saving={saving}
      error={error}
      saveEnabled={canSave && resolvedModelReady}
      mode={editingId ? 'edit' : 'create'}
      onChange={onChange}
      onCancel={onCancel}
      onSave={onSave}
      runtimePicker={(
        <>
          <RuntimeSelector
            value={draft.runtimeKind}
            onChange={updateRuntimeKind}
            options={runtimeOptions}
          />
          <ProviderModelPicker
            providerTargets={selectableProfiles}
            selectedProviderTargetId={selectedProfileId}
            selectedModelId={selectedModelId}
            selectedModel={effectiveSelectedModel}
            modelsByProviderTargetId={modelsByProfileId}
            loadingProviderTargetIds={loadingProfileIds}
            thinkingValue={draft.thinkingEffort}
            thinkingOptions={thinkingOptions}
            isLoadingSelectedModels={isLoadingModels}
            emptyProviderTargetsLabel={t('runtime.noCompatibleTargetsShort')}
            emptySelectionLabel={t('runtime.selectModel')}
            menuSide="bottom"
            menuAlign="start"
            triggerTestId="automation-provider-model-selector"
            getThinkingOptionsForModel={model =>
              filterThinkingOptionsForModel(model, thinkingOptions)}
            onRequestProviderTargetModels={requestProfileModels}
            onSelectProviderTarget={updateProviderTarget}
            onSelectModel={updateModel}
            onSelectThinking={updateThinkingEffort}
          />
        </>
      )}
    />
  )
}
