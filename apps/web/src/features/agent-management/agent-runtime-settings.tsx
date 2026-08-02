import {
  CheckboxLine as SquareCheckIcon,
  CloseLine as XIcon,
  DeleteLine as Trash2Icon,
  DownloadLine as DownloadIcon,
  DownSmallLine as ChevronDownIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
  RightSmallLine as ChevronRightIcon,
  SearchLine as SearchIcon,
  ServerLine as ServerIcon,
  SquareLine as SquareIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getExternalProviderSourcesOptions,
  getExternalProviderSourcesRecordsOptions,
  getProviderTargetsQueryKey,
  patchExternalProviderSourcesBySourceKeyRecordsByExternalRecordIdRuntimeTargetMutation,
  postExternalProviderSourcesRefreshMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { ProviderIconTile } from '~/components/common/provider-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { toastManager } from '~/components/ui/toast'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import type { AgentProfile } from '~/features/agent-runtime/types'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { AGENTS_QUERY_KEY } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'

import { SettingsMasterDetail } from '../settings/settings-container'
import { AddProviderDialog } from './add-provider-dialog'
import { ExternalProviderRecordDetailPanel } from './external-provider-record-detail-panel'
import { ImportProviderDialog } from './import-provider-dialog'
import { ProfileDetailPanel } from './profile-detail-panel'
import { ProviderTestStatusDot } from './provider-connection-test'
import { collectProviderListGroups } from './provider-list-groups'
import type {
  ExternalProviderRecordView,
  ExternalProviderSourceView,
  ProviderListEntry,
} from './provider-settings-utils'
import {
  buildProfileId,
  presetForProfile,
  presetForProviderKind,
  PROVIDER_KIND_LABELS,
  providerListEntryId,
} from './provider-settings-utils'
import {
  applyVisibleRangeSelection,
  mergeVisibleSelection,
  pruneSelectedIds,
  removeVisibleSelection,
  selectedIdFromSet,
  selectedRecords,
  visibleRecordsAreSelected,
} from './settings-multi-selection'
import { useSettingsSelectionShortcuts } from './settings-selection-shortcuts'

function hostnameOf(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  try {
    return new URL(url).hostname
  }
  catch {
    return null
  }
}

function parseProfileConfigForUpdate(configJson: string): Record<string, unknown> {
  const parsed = JSON.parse(configJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

function defaultGroupOpen(groupKind: 'external-plugin' | 'external-source' | 'manual'): boolean {
  return groupKind === 'manual' || groupKind === 'external-plugin'
}

function externalRecordCanToggle(record: ExternalProviderRecordView): boolean {
  return !!record.providerTargetId && record.status !== 'missing' && record.status !== 'unsupported'
}

const ProviderRow = ({
    entry,
    active,
    selected,
    selectionActive,
    onOpenEntry,
    onSelectEntry,
  }: {
    entry: ProviderListEntry
    active: boolean
    selected: boolean
    selectionActive: boolean
    onOpenEntry: (entryId: string, shiftKey: boolean) => void
    onSelectEntry: (entryId: string, selected: boolean, shiftKey: boolean) => void
  }) => {
    const checkboxShiftKeyRef = useRef(false)
    const manual = entry.kind === 'manual'
    const providerKind = manual ? entry.profile.providerKind : entry.record.providerKind
    const preset = manual ? presetForProfile(entry.profile) : presetForProviderKind(providerKind)
    const title = manual ? entry.profile.name : entry.record.name
    const cfg = manual ? ProfileConfigJsonSchema.parse(entry.profile.configJson) : null
    const externalModel = !manual && typeof entry.record.metadata.model === 'string'
      ? entry.record.metadata.model
      : null
    const externalBaseUrl = !manual && typeof entry.record.metadata.baseUrl === 'string'
      ? entry.record.metadata.baseUrl
      : null
    const externalIconSlug = !manual && typeof entry.record.metadata.iconSlug === 'string'
      ? entry.record.metadata.iconSlug
      : null
    const externalIconUrl = !manual && typeof entry.record.metadata.iconUrl === 'string'
      ? entry.record.metadata.iconUrl
      : !manual && typeof entry.record.metadata.avatarUrl === 'string'
        ? entry.record.metadata.avatarUrl
        : null
    const modelLabel = cfg?.model || externalModel
    const endpointHost = hostnameOf(cfg?.baseUrl || cfg?.openaiBaseUrl || externalBaseUrl)
    // The endpoint host is the most identifying detail in a list where every
    // row shares the same provider kind.
    const subtitle = endpointHost ?? modelLabel ?? PROVIDER_KIND_LABELS[providerKind]
    const alwaysOn = !manual && entry.record.status === 'unsupported'
    const inactive = manual
      ? !entry.profile.enabled
      : entry.record.status !== 'active' || !entry.record.runtimeTargetEnabled
    const testId = manual
      ? `agent-profile-row-${entry.profile.id}`
      : `external-provider-row-${entry.record.id}`

    return (
      <div
        data-testid={testId}
        className={cn(
          'group/sidebar-row flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-left outline-none',
          'transition-[background-color,opacity,scale] duration-150',
          active
            ? 'bg-foreground/[0.045] text-foreground'
            : 'hover:bg-foreground/[0.035] active:bg-foreground/6',
          inactive && !active && !alwaysOn && 'opacity-60',
        )}
      >
        <Checkbox
          checked={selected}
          className={cn(
            'transition-opacity',
            selected || selectionActive
              ? 'opacity-100'
              : 'opacity-0 group-hover/sidebar-row:opacity-100',
          )}
          onClickCapture={(event) => {
            checkboxShiftKeyRef.current = event.shiftKey
          }}
          onCheckedChange={(value) => {
            onSelectEntry(entry.id, !!value, checkboxShiftKeyRef.current)
            checkboxShiftKeyRef.current = false
          }}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left outline-none"
          onClick={event => onOpenEntry(entry.id, event.shiftKey)}
        >
          <ProviderIconTile
            iconSlug={manual ? entry.profile.iconSlug : externalIconSlug}
            iconUrl={manual ? null : externalIconUrl}
            presetId={preset?.id ?? null}
            size="sm"
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <span
              className={cn(
                'block min-w-0 truncate text-[12.5px] leading-tight',
                active ? 'font-medium text-foreground' : 'text-foreground/90',
              )}
            >
              {title}
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/70">
              {subtitle}
            </span>
          </div>
          <ProviderTestStatusDot
            providerTargetId={manual ? entry.profile.id : entry.record.providerTargetId}
          />
          <ChevronRightIcon
            className={cn(
              'size-3 shrink-0 !text-muted-foreground/40 transition-[opacity,transform,width] duration-150',
              active
                ? 'w-3 opacity-100 translate-x-0'
                : 'w-0 opacity-0 -translate-x-1 group-hover/sidebar-row:w-3 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0',
            )}
          />
        </button>
      </div>
    )
  }
ProviderRow.displayName = 'ProviderRow'

export function AgentRuntimeSettings() {
  const { t } = useTranslation('agentManagement')
  const queryClient = useQueryClient()
  const {
    profiles,
    isSuccess: profilesReady,
    refetch,
    createProfile,
    updateProfile,
    removeProfile,
  } = useAgentProfiles()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionAnchorIdRef = useRef<string | null>(null)
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)
  const [batchBusy, setBatchBusy] = useState(false)
  const [pendingBatchRemoveProfiles, setPendingBatchRemoveProfiles] = useState<AgentProfile[]>([])
  const [groupOpenOverrides, setGroupOpenOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  )
  const {
    data: externalSources = [],
    isSuccess: externalSourcesReady,
    refetch: refetchExternalSources,
  } = useQuery(
    getExternalProviderSourcesOptions(),
  )
  const {
    data: externalRecords = [],
    isSuccess: externalRecordsReady,
    refetch: refetchExternalRecords,
  } = useQuery(
    getExternalProviderSourcesRecordsOptions(),
  )
  const externalSourceViews = externalSources as ExternalProviderSourceView[]
  const externalRecordViews = externalRecords as ExternalProviderRecordView[]
  const sourceById = useMemo(
    () => new Map(externalSourceViews.map(source => [source.id, source])),
    [externalSourceViews],
  )
  const settingsProvidersReady = profilesReady && externalSourcesReady && externalRecordsReady

  const refreshExternalSources = useMutation({
    ...postExternalProviderSourcesRefreshMutation(),
    onSuccess: async (data) => {
      await Promise.all([refetch(), refetchExternalSources(), refetchExternalRecords()])
      await queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })

      const results = Array.isArray(data) ? data : [data]
      const errors = results.filter((r: { status: string }) => r.status === 'error')
      const ok = results.filter((r: { status: string }) => r.status !== 'error')

      if (errors.length > 0) {
        toastManager.add({
          type: 'error',
          title: t('runtime.toast.syncFailed', { sourceCount: errors.length }),
          description: errors.map((e: { message?: string, sourceKey: string }) => e.message ?? e.sourceKey).join(', ') || undefined,
        })
      }
      if (ok.length > 0) {
        toastManager.add({
          type: 'success',
          title: t('runtime.toast.sourcesRefreshed', { sourceCount: ok.length }),
        })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('runtime.toast.refreshFailed'),
        description:
          error instanceof Error ? error.message : t('runtime.toast.externalSourcesRefreshFailed'),
      })
    },
  })
  const updateExternalRuntimeTarget = useMutation(
    patchExternalProviderSourcesBySourceKeyRecordsByExternalRecordIdRuntimeTargetMutation(),
  )

  const providerGroups = useMemo(
    () => collectProviderListGroups(profiles, externalRecordViews, externalSourceViews),
    [externalRecordViews, externalSourceViews, profiles],
  )
  const visibleProfileGroups = useMemo(() => {
    if (!deferredFilter.trim()) {
      return providerGroups
    }
    const q = deferredFilter.trim().toLowerCase()
    return providerGroups
      .map(group => ({
        ...group,
        entries: group.entries.filter((entry) => {
          const label = entry.kind === 'manual' ? entry.profile.name : entry.record.name
          const providerKind = entry.kind === 'manual'
            ? entry.profile.providerKind
            : entry.record.providerKind
          const kindLabel = PROVIDER_KIND_LABELS[providerKind] ?? ''
          const appLabel = entry.kind === 'external' ? entry.record.app : ''
          return (
            group.label.toLowerCase().includes(q)
            || label.toLowerCase().includes(q)
            || kindLabel.toLowerCase().includes(q)
            || appLabel.toLowerCase().includes(q)
          )
        }),
      }))
      .filter(group => group.entries.length > 0)
  }, [deferredFilter, providerGroups])
  const providerEntries = useMemo(
    () => providerGroups.flatMap(group => group.entries),
    [providerGroups],
  )
  const visibleEntries = useMemo(
    () => visibleProfileGroups.flatMap(group => group.entries),
    [visibleProfileGroups],
  )
  const availableEntryIds = useMemo(
    () => new Set(providerEntries.map(entry => entry.id)),
    [providerEntries],
  )
  const prunedSelectedIds = pruneSelectedIds(selectedIds, availableEntryIds)
  if (prunedSelectedIds !== selectedIds) {
    setSelectedIds(prunedSelectedIds)
  }
  const currentSelectedIds = prunedSelectedIds

  const selectedEntryId = selectedIdFromSet(currentSelectedIds)
  const selectedEntry = useMemo(
    () => selectedEntryId
      ? (providerEntries.find(entry => entry.id === selectedEntryId) ?? null)
      : null,
    [providerEntries, selectedEntryId],
  )
  const selectedEntries = useMemo(
    () => selectedRecords(providerEntries, currentSelectedIds),
    [providerEntries, currentSelectedIds],
  )
  const selectedProfiles = useMemo(
    () => selectedEntries.flatMap(entry => (entry.kind === 'manual' ? [entry.profile] : [])),
    [selectedEntries],
  )
  const selectedExternalRecords = useMemo(
    () => selectedEntries.flatMap(entry => (entry.kind === 'external' ? [entry.record] : [])),
    [selectedEntries],
  )
  const toggleableSelectedProfiles = selectedProfiles
  const toggleableSelectedExternalRecords = selectedExternalRecords.filter(externalRecordCanToggle)
  const removableSelectedProfiles = selectedProfiles
  const toggleableSelectedCount = toggleableSelectedProfiles.length + toggleableSelectedExternalRecords.length
  const allVisibleSelected = visibleRecordsAreSelected(visibleEntries, currentSelectedIds)
  const hasFilter = deferredFilter.trim().length > 0
  const providerGroupLabel = (group: (typeof visibleProfileGroups)[number]) => {
      return group.kind === 'manual' ? t('runtime.group.manual') : group.label
    }

  const toggleGroupCollapsed = (groupId: string, open: boolean) => {
    setGroupOpenOverrides((prev) => {
      const next = new Map(prev)
      next.set(groupId, open)
      return next
    })
  }

  const handleAddProviderComplete = (newProfileId?: string) => {
      setAddProviderOpen(false)
      void refetch().finally(() => {
        const nextId = newProfileId ? providerListEntryId('manual', newProfileId) : null
        setSelectedIds(nextId ? new Set([nextId]) : new Set())
        selectionAnchorIdRef.current = nextId
      })
    }

  const handleRemoveProfile = async (id: string) => {
      await removeProfile.mutateAsync({ path: { id } })
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(providerListEntryId('manual', id))
        return next
      })
      if (selectionAnchorIdRef.current === providerListEntryId('manual', id)) {
        selectionAnchorIdRef.current = null
      }
    }

  const handleDuplicateProfile = async (profile: AgentProfile) => {
    const name = `${profile.name} (copy)`
    const newId = buildProfileId(name, `copy-${Date.now()}`)
    await createProfile.mutateAsync({
      path: { id: newId },
      body: {
        name,
        providerKind: profile.providerKind,
        enabled: false,
        config: parseProfileConfigForUpdate(profile.configJson),
        credentialRef: profile.credentialRef ?? null,
      },
    })
    await refetch()
    const entryId = providerListEntryId('manual', newId)
    setSelectedIds(new Set([entryId]))
    selectionAnchorIdRef.current = entryId
  }

  const handleToggleProfile = async (profile: AgentProfile, enabled: boolean) => {
      await updateProfile.mutateAsync({
        path: { id: profile.id },
        body: {
          name: profile.name,
          providerKind: profile.providerKind,
          enabled,
          config: parseProfileConfigForUpdate(profile.configJson),
          credentialRef: profile.credentialRef ?? null,
        },
      })
    }

  const handleExternalProviderUpdated = () => {
    void Promise.all([
      refetchExternalSources(),
      refetchExternalRecords(),
    ])
  }

  const handleToggleExternalRecord = async (record: ExternalProviderRecordView, enabled: boolean) => {
      await updateExternalRuntimeTarget.mutateAsync({
        path: {
          sourceKey: record.sourceKey,
          externalRecordId: record.externalId,
        },
        body: { enabled },
      })
    }

  const toggleVisibleSelected = () => {
    setSelectedIds(prev =>
      allVisibleSelected
        ? removeVisibleSelection(prev, visibleEntries)
        : mergeVisibleSelection(prev, visibleEntries))
  }

  const selectVisibleProfiles = () => {
    setSelectedIds(prev => mergeVisibleSelection(prev, visibleEntries))
    selectionAnchorIdRef.current = visibleEntries.at(-1)?.id ?? null
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }

  const selectEntry = (entryId: string, selected: boolean, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        if (shiftKey) {
          return applyVisibleRangeSelection(
            prev,
            visibleEntries,
            selectionAnchorIdRef.current,
            entryId,
            selected,
          )
        }

        const next = new Set(prev)
        if (selected) {
          next.add(entryId)
        }
 else {
          next.delete(entryId)
        }
        return next
      })
      selectionAnchorIdRef.current = entryId
    }

  const openEntry = (entryId: string, shiftKey: boolean) => {
      if (shiftKey) {
        selectEntry(entryId, true, true)
        return
      }

      setSelectedIds(new Set([entryId]))
      selectionAnchorIdRef.current = entryId
    }

  const handleBatchToggle = async (enabled: boolean) => {
      if (toggleableSelectedCount === 0) {
        return
      }
      setBatchBusy(true)
      try {
        await Promise.all([
          ...toggleableSelectedProfiles.map(profile => handleToggleProfile(profile, enabled)),
          ...toggleableSelectedExternalRecords.map(record => handleToggleExternalRecord(record, enabled)),
        ])
        if (toggleableSelectedExternalRecords.length > 0) {
          await Promise.all([
            refetchExternalRecords(),
            queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
          ])
        }
        setSelectedIds(new Set())
        selectionAnchorIdRef.current = null
        setBatchBusy(false)
      }
      catch (error) {
        setBatchBusy(false)
        throw error
      }
    }

  const requestBatchRemove = () => {
    if (batchBusy || removableSelectedProfiles.length === 0) {
      return
    }
    setPendingBatchRemoveProfiles(removableSelectedProfiles)
  }

  const handleBatchRemove = async (profilesToRemove: AgentProfile[]) => {
    if (profilesToRemove.length === 0) {
      return
    }
    setBatchBusy(true)
    try {
      await Promise.all(
        profilesToRemove.map(profile => removeProfile.mutateAsync({ path: { id: profile.id } })),
      )
      setSelectedIds(new Set())
      selectionAnchorIdRef.current = null
      setBatchBusy(false)
    }
    catch (error) {
      setBatchBusy(false)
      throw error
    }
  }

  const confirmBatchRemove = async () => {
    const profilesToRemove = pendingBatchRemoveProfiles
    setPendingBatchRemoveProfiles([])
    await handleBatchRemove(profilesToRemove)
  }

  const selectionShortcutScopeRef = useSettingsSelectionShortcuts({
    hasVisibleRecords: visibleEntries.length > 0,
    hasSelection: currentSelectedIds.size > 0,
    hasDraft: false,
    canDeleteSelection: !batchBusy && removableSelectedProfiles.length > 0,
    onSelectVisible: selectVisibleProfiles,
    onClearSelection: clearSelection,
    onDeleteSelection: () => {
      requestBatchRemove()
    },
  })

  const headerActions = (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => refreshExternalSources.mutate({})}
        disabled={refreshExternalSources.isPending}
      >
        <RefreshCwIcon
          className={cn('size-3.5', refreshExternalSources.isPending && 'animate-spin')}
        />
        {t('runtime.action.refreshSources')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
        <DownloadIcon />
        {t('runtime.action.import')}
      </Button>
      <Button data-testid="add-provider-btn" size="sm" onClick={() => setAddProviderOpen(true)}>
        <PlusIcon />
        {t('runtime.action.addProvider')}
      </Button>
    </div>
  )

  const floatingToolbar = (
    <AnimatePresence initial={false}>
      {currentSelectedIds.size > 0 && (
        <m.div
          key="agent-runtime-selection-bar"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
          className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex min-h-10 max-w-full flex-wrap items-center justify-center gap-1 rounded-full bg-popover px-2 py-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
            <button
              type="button"
              onClick={toggleVisibleSelected}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {allVisibleSelected
? (
                <SquareCheckIcon className="size-3.5 !text-primary" />
              )
: (
                <SquareIcon className="size-3.5" />
              )}
              <span>{t('runtime.selection.selected', { selectedCount: currentSelectedIds.size })}</span>
            </button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <Button
              size="xs"
              variant="ghost"
              className="rounded-full"
              onClick={() => void handleBatchToggle(true)}
              disabled={batchBusy || toggleableSelectedCount === 0}
            >
              {t('runtime.selection.enable')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="rounded-full"
              onClick={() => void handleBatchToggle(false)}
              disabled={batchBusy || toggleableSelectedCount === 0}
            >
              {t('runtime.selection.disable')}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              className="rounded-full"
              onClick={requestBatchRemove}
              disabled={batchBusy || removableSelectedProfiles.length === 0}
            >
              <Trash2Icon className="size-3" />
              {t('runtime.selection.delete')}
            </Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full"
              aria-label={t('runtime.selection.clear')}
              onClick={clearSelection}
            >
              <XIcon />
            </Button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )

  const listPane = (
    <div
      ref={selectionShortcutScopeRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3"
    >
      <div className="relative min-w-0">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('runtime.search.placeholder')}
          className="h-8 pl-8 pr-2 text-[12.5px]"
        />
      </div>

      <ScrollArea className="-mx-1 min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-0.5 px-1">
          {visibleEntries.length > 0 && (
                <div className="mb-1 flex items-center justify-between gap-2 px-2 py-0.5 text-[10.5px] text-muted-foreground/60">
                  <span>{t('runtime.visible.count', { visibleCount: visibleEntries.length })}</span>
                  <button
                    type="button"
                    onClick={toggleVisibleSelected}
                    className="text-muted-foreground/70 hover:text-foreground"
                  >
                    {allVisibleSelected
                      ? t('runtime.visible.unselect')
                      : t('runtime.visible.select')}
                  </button>
                </div>
              )}

              {visibleProfileGroups.map((group) => {
                const selectedInGroup
                  = !!selectedEntryId && group.entries.some(entry => entry.id === selectedEntryId)
                const isOpen
                  = hasFilter
                    || selectedInGroup
                    || groupOpenOverrides.get(group.id)
                    || (!groupOpenOverrides.has(group.id) && defaultGroupOpen(group.kind))
                return (
                  <Collapsible
                    key={group.id}
                    open={isOpen}
                    onOpenChange={open => toggleGroupCollapsed(group.id, open)}
                    className="flex min-w-0 flex-col gap-0.5"
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'flex min-w-0 items-center justify-between gap-2 rounded-md px-2 pb-0.5 pt-2 h-6 text-[10.5px] font-medium text-muted-foreground/60 outline-none',
                          'transition-colors hover:bg-foreground/[0.03] hover:text-foreground/80',
                          'pt-0',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ChevronDownIcon
                            className={cn(
                              'size-3 shrink-0 !text-muted-foreground/45 transition-transform duration-200',
                              !isOpen && '-rotate-90',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 truncate">{providerGroupLabel(group)}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{group.entries.length}</span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex min-w-0 flex-col gap-0.5">
                      {group.entries.map(entry => (
                        <ProviderRow
                          key={entry.id}
                          entry={entry}
                          active={selectedEntryId === entry.id}
                          selected={currentSelectedIds.has(entry.id)}
                          selectionActive={currentSelectedIds.size > 0}
                          onOpenEntry={openEntry}
                          onSelectEntry={selectEntry}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}

              {visibleEntries.length === 0 && (
                <div className="px-2 py-6 text-center">
                  <p className="text-[11.5px] text-muted-foreground/70">
                    {filter ? t('runtime.empty.noMatches') : t('runtime.empty.noProviders')}
                  </p>
                </div>
              )}
        </div>
      </ScrollArea>

      {profiles.length > 0 && (
        <div className="px-3 pb-3 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
          {t('runtime.summary.providers', {
            manualCount: profiles.length,
          })}
        </div>
      )}
    </div>
  )

  // The detail pane only ever shows a provider detail or an empty state now —
  // adding a provider lives in AddProviderDialog. A single padded column and a
  // keyed crossfade keep switches from visually jumping.
  const detailKey = selectedEntries.length > 1
    ? 'multi-selection'
    : selectedEntryId ?? 'empty'

  const detailPane = (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.div
        key={detailKey}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className="flex min-h-full min-w-0 flex-1 flex-col px-7 py-6"
      >
        {selectedEntries.length > 1
          ? (
              <div className="flex flex-1 items-center justify-center">
                <Empty className="border-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ServerIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t('runtime.multiSelected.title', { selectedCount: selectedEntries.length })}
                    </EmptyTitle>
                    <EmptyDescription>{t('runtime.multiSelected.description')}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button size="sm" variant="outline" onClick={clearSelection}>
                      <XIcon />
                      {t('runtime.selection.clearSelection')}
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            )
          : selectedEntry?.kind === 'manual'
            ? (
                <div className="min-w-0 flex-1">
                  <ProfileDetailPanel
                    profile={selectedEntry.profile}
                    onRemove={() => void handleRemoveProfile(selectedEntry.profile.id)}
                    onToggle={enabled => void handleToggleProfile(selectedEntry.profile, enabled)}
                    onDuplicate={() => void handleDuplicateProfile(selectedEntry.profile)}
                    onSaved={() => {
                      void refetch()
                    }}
                  />
                </div>
              )
            : selectedEntry?.kind === 'external'
              ? (
                  <div className="min-w-0 flex-1">
                    <ExternalProviderRecordDetailPanel
                      record={selectedEntry.record}
                      source={sourceById.get(selectedEntry.record.sourceKey) ?? null}
                      onUpdated={handleExternalProviderUpdated}
                    />
                  </div>
                )
              : (
                  <div className="flex flex-1 items-center justify-center">
                    <Empty className="border-none">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ServerIcon />
                        </EmptyMedia>
                        <EmptyTitle>{t('runtime.noSelection.title')}</EmptyTitle>
                        <EmptyDescription>{t('runtime.noSelection.description')}</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button size="sm" variant="outline" onClick={() => setAddProviderOpen(true)}>
                          <PlusIcon />
                          {t('runtime.noSelection.addProvider')}
                        </Button>
                      </EmptyContent>
                    </Empty>
                  </div>
                )}
      </m.div>
    </AnimatePresence>
  )

  return (
    <SettingsMasterDetail
      data-testid="agent-runtime-settings"
      data-settings-providers-ready={settingsProvidersReady ? 'true' : 'false'}
      title={t('runtime.header.title')}
      description={t('runtime.header.description')}
      action={headerActions}
      floatingToolbar={floatingToolbar}
      list={listPane}
      detail={detailPane}
      listWidth={360}
    >
      <ImportProviderDialog open={importOpen} onOpenChange={setImportOpen} />
      <AddProviderDialog
        open={addProviderOpen}
        onOpenChange={setAddProviderOpen}
        onComplete={handleAddProviderComplete}
      />
      <AlertDialog
        open={pendingBatchRemoveProfiles.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setPendingBatchRemoveProfiles([])
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('runtime.deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('runtime.deleteDialog.description', {
                count: pendingBatchRemoveProfiles.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={batchBusy}>
              {t('runtime.deleteDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              onClick={() => void confirmBatchRemove()}
              disabled={batchBusy}
            >
              {t('runtime.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsMasterDetail>
  )
}
