import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toastManager } from '~/components/ui/toast'
import {
  listRuntimeCatalogForSurface,
  runtimeCatalogItemUsesModelSelection,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { listAutomationArtifacts, listAutomationRuns, listAutomationTriage } from './api-client'
import { AutomationCreatePanelContainer } from './automation-create-panel-container'
import { AutomationDashboardView } from './automation-dashboard-view'
import { AutomationDetailView } from './automation-detail-view'
import type { CreateAutomationDraft } from './automation-draft'
import {
  createDefaultAutomationDraft,
  DEFAULT_SCHEDULE,
  parseRruleToSchedule,
  toCreateAutomationInput,
} from './automation-draft'
import { AutomationEmptySelectionView } from './automation-empty-selection-view'
import {
  getAutomationRecipe,
  getAutomationTrigger,
  getLatestAutomationRun,
} from './automation-presentation'
import type { AutomationDefinition } from './types'
import {
  automationQueryKeys,
  useAutomationDefinitions,
  useCreateAutomation,
  useRunAutomationNow,
  useStopAutomationRun,
  useUpdateAutomation,
  useUpdateAutomationRunTriage,
} from './use-automations'

export interface AutomationDashboardProps {
  onBack?: () => void
}

export function AutomationDashboard({ onBack }: AutomationDashboardProps) {
  const { i18n, t } = useTranslation('automation')
  const { workspaces } = useWorkspaces()
  const { runtimes } = useRuntimeCatalog()
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CreateAutomationDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const definitionsQuery = useAutomationDefinitions(workspaceFilter)
  const definitions = definitionsQuery.data ?? []
  const triageQuery = useQuery({
    queryKey: ['automations', 'triage', { workspaceId: workspaceFilter }],
    queryFn: () => listAutomationTriage(workspaceFilter),
    staleTime: 10_000,
    retry: 1,
  })
  const triageRuns = triageQuery.data ?? []
  const defaultRuntimeKind = useMemo(
    () => listRuntimeCatalogForSurface(runtimes, 'chat')
      .filter(runtimeCatalogItemUsesModelSelection)[0]
      ?.runtimeKind ?? '',
    [runtimes],
  )
  const workspaceNames = useMemo(
    () => Object.fromEntries(
      workspaces.map(workspace => [workspace.id, workspace.name]),
    ),
    [workspaces],
  )
  const selectedDefinition = draft
    ? null
    : selectedId
      ? definitions.find(definition => definition.id === selectedId) ?? null
      : definitions[0] ?? null
  const selectedAutomationId = selectedDefinition?.id ?? null
  const runsQuery = useQuery({
    queryKey: selectedAutomationId
      ? automationQueryKeys.runs(selectedAutomationId)
      : ['automations', 'missing', 'runs'],
    queryFn: () => listAutomationRuns(selectedAutomationId ?? ''),
    enabled: Boolean(selectedAutomationId),
    staleTime: 10_000,
    retry: 1,
  })
  const artifactsQuery = useQuery({
    queryKey: selectedAutomationId
      ? automationQueryKeys.artifacts(selectedAutomationId)
      : ['automations', 'missing', 'artifacts'],
    queryFn: () => listAutomationArtifacts(selectedAutomationId ?? ''),
    enabled: Boolean(selectedAutomationId),
    staleTime: 10_000,
    retry: 1,
  })
  const createAutomationMutation = useCreateAutomation()
  const updateAutomationMutation = useUpdateAutomation()
  const runNowMutation = useRunAutomationNow()
  const stopRunMutation = useStopAutomationRun()
  const triageMutation = useUpdateAutomationRunTriage()
  const latestRun = selectedDefinition
    ? getLatestAutomationRun(selectedDefinition, runsQuery.data)
    : null
  const automationReady = definitionsQuery.isSuccess
    && (
      !selectedAutomationId
      || (runsQuery.isSuccess && artifactsQuery.isSuccess)
    )
  const locale = i18n.resolvedLanguage ?? i18n.language

  const startDraft = useCallback(() => {
    setDraft(createDefaultAutomationDraft(
      '',
      workspaceFilter,
      defaultRuntimeKind,
    ))
    setEditingId(null)
    setDraftError(null)
    setSelectedId(null)
  }, [defaultRuntimeKind, workspaceFilter])

  const startEdit = useCallback((definition: AutomationDefinition) => {
    const trigger = getAutomationTrigger(definition)
    const recipe = getAutomationRecipe(definition)
    setDraft({
      title: definition.title,
      description: definition.description ?? '',
      workspaceId: definition.workspaceId ?? null,
      enabled: definition.enabled !== false,
      schedule: trigger
        ? parseRruleToSchedule(trigger.rrule)
        : DEFAULT_SCHEDULE,
      timezone: trigger?.timezone
        || Intl.DateTimeFormat().resolvedOptions().timeZone
        || 'UTC',
      misfirePolicy: trigger?.misfirePolicy ?? 'run_latest',
      providerTargetId: recipe?.providerTargetId ?? '',
      runtimeKind: recipe?.runtimeKind ?? defaultRuntimeKind,
      modelId: recipe?.modelId ?? null,
      thinkingEffort: recipe?.thinkingEffort ?? null,
      sessionPolicy: recipe?.sessionPolicy ?? 'new',
      isolationPolicy: recipe?.isolationPolicy ?? 'workspace',
      noFindingsBehavior:
        recipe?.completionPolicy?.noFindingsBehavior ?? 'archive',
      prompt: recipe?.prompt ?? '',
      artifactName:
        recipe?.artifactRequests?.[0]?.name ?? 'automation-run.md',
    })
    setEditingId(definition.id)
    setDraftError(null)
  }, [defaultRuntimeKind])

  const cancelDraft = useCallback(() => {
    setDraft(null)
    setEditingId(null)
    setDraftError(null)
  }, [])

  const updateDraft = useCallback((nextDraft: CreateAutomationDraft) => {
    setDraft(nextDraft)
    setDraftError(null)
  }, [])

  const saveDraft = useCallback(async () => {
    if (!draft) {
      return
    }
    try {
      setDraftError(null)
      const input = toCreateAutomationInput(draft, t)
      if (editingId) {
        const updated = await updateAutomationMutation.mutateAsync({
          id: editingId,
          input: {
            title: input.title,
            description: input.description,
            trigger: input.trigger,
            recipe: input.recipe,
          },
        })
        setDraft(null)
        setEditingId(null)
        setSelectedId(updated.id)
        toastManager.add({ type: 'success', title: t('toast.updated') })
        return
      }

      const created = await createAutomationMutation.mutateAsync(input)
      setDraft(null)
      setSelectedId(created.id)
      toastManager.add({ type: 'success', title: t('toast.created') })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDraftError(message)
      toastManager.add({
        type: 'error',
        title: editingId
          ? t('toast.updateFailed')
          : t('toast.createFailed'),
        description: message,
      })
    }
  }, [
    createAutomationMutation,
    draft,
    editingId,
    t,
    updateAutomationMutation,
  ])

  const content = draft
    ? (
        <AutomationCreatePanelContainer
          draft={draft}
          saving={
            createAutomationMutation.isPending
            || updateAutomationMutation.isPending
          }
          error={draftError}
          canSave={
            !createAutomationMutation.isPending
            && !updateAutomationMutation.isPending
          }
          editingId={editingId}
          onChange={updateDraft}
          onCancel={cancelDraft}
          onSave={() => void saveDraft()}
        />
      )
    : selectedDefinition
      ? (
          <AutomationDetailView
            definition={selectedDefinition}
            latestRun={latestRun}
            runs={runsQuery.data ?? []}
            runsLoading={runsQuery.isLoading}
            artifacts={artifactsQuery.data ?? []}
            artifactsLoading={artifactsQuery.isLoading}
            workspaceNames={workspaceNames}
            locale={locale}
            runNowPending={runNowMutation.isPending}
            onEdit={() => startEdit(selectedDefinition)}
            onRunNow={id => runNowMutation.mutate(id)}
            onStopRun={runId =>
              stopRunMutation.mutate({
                automationId: selectedDefinition.id,
                runId,
              })}
            onTriageRun={(runId, status) =>
              triageMutation.mutate({
                automationId: selectedDefinition.id,
                runId,
                status,
              })}
          />
        )
      : <AutomationEmptySelectionView onCreate={startDraft} />

  return (
    <AutomationDashboardView
      definitions={definitions}
      triageRuns={triageRuns}
      workspaces={workspaces}
      selectedAutomationId={selectedAutomationId}
      selectedLatestRun={latestRun}
      workspaceFilter={workspaceFilter}
      hasDraft={Boolean(draft)}
      definitionsLoading={definitionsQuery.isLoading}
      triageLoading={triageQuery.isLoading}
      error={definitionsQuery.error?.message ?? null}
      automationReady={automationReady}
      runNowPending={runNowMutation.isPending}
      contentKey={draft
        ? `draft:${editingId ?? 'new'}`
        : selectedAutomationId ?? 'empty'}
      content={content}
      onBack={onBack}
      onCreate={startDraft}
      onRefresh={() => void definitionsQuery.refetch()}
      onRunNow={() => {
        if (selectedAutomationId) {
          runNowMutation.mutate(selectedAutomationId)
        }
      }}
      onSelectDefinition={setSelectedId}
      onSelectDraft={() => setSelectedId(null)}
      onWorkspaceFilterChange={setWorkspaceFilter}
    />
  )
}
