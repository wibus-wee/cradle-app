import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getBackgroundActivitiesOptions,
  getStorageOverviewOptions,
  getStorageOverviewQueryKey,
  postBackgroundActivitiesByOwnerNamespaceByKeyRunMutation,
  postStorageSessionsDeleteMutation,
  postStorageSessionsPurgeTranscriptsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'

import type { StorageManagerAction, StorageManagerCopy, StorageQuickAction } from './storage-manager-view'
import { StorageManagerView } from './storage-manager-view'
import { formatBytes } from './storage-visuals'

const STORAGE_MEASUREMENT_ACTIVITY = {
  ownerNamespace: 'storage',
  key: 'measure-usage',
} as const

export function StorageManager() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null)
  const overview = useQuery(getStorageOverviewOptions())
  const activities = useQuery({
    ...getBackgroundActivitiesOptions(),
    enabled: refreshStartedAt !== null,
    refetchInterval: refreshStartedAt === null ? false : 500,
  })
  const refresh = useMutation({
    ...postBackgroundActivitiesByOwnerNamespaceByKeyRunMutation(),
    onSuccess: (activity) => {
      if (activity.startedAt !== null) {
        setRefreshStartedAt(activity.startedAt)
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('storage.toast.failed'),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
  const purge = useMutation(postStorageSessionsPurgeTranscriptsMutation())
  const remove = useMutation(postStorageSessionsDeleteMutation())
  const busy = purge.isPending || remove.isPending

  useEffect(() => {
    if (refreshStartedAt === null) {
      return
    }
    if (activities.isError && !activities.isFetching) {
      setRefreshStartedAt(null)
      toastManager.add({
        type: 'error',
        title: t('storage.toast.failed'),
      })
      return
    }
    const activity = activities.data?.find(candidate => (
      candidate.ownerNamespace === STORAGE_MEASUREMENT_ACTIVITY.ownerNamespace
      && candidate.key === STORAGE_MEASUREMENT_ACTIVITY.key
      && candidate.startedAt === refreshStartedAt
    ))
    if (!activity || activity.status === 'running') {
      return
    }

    setRefreshStartedAt(null)
    if (activity.status === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: getStorageOverviewQueryKey() })
      return
    }
    toastManager.add({
      type: 'error',
      title: t('storage.toast.failed'),
      description: activity.lastError ?? undefined,
    })
  }, [activities.data, activities.isError, activities.isFetching, queryClient, refreshStartedAt, t])

  const copy = useMemo<StorageManagerCopy>(() => ({
    title: t('storage.page.title'),
    description: t('storage.page.description'),
    totalUsed: t('storage.totalUsed'),
    reclaimableTotal: t('storage.reclaimableTotal'),
    measuredNow: t('storage.measuredNow'),
    measuredAt: time => t('storage.measuredAt', { time }),
    dataDirectory: t('storage.dataDirectory'),
    refresh: t('storage.action.refresh'),
    actionCopyPath: t('storage.action.copyPath'),
    actionCopied: t('storage.action.copied'),
    actionRetry: t('storage.action.retry'),
    actionCancel: t('storage.action.cancel'),
    categories: {
      database: t('storage.category.database'),
      runtime: t('storage.category.runtime'),
      attachments: t('storage.category.attachments'),
      artifacts: t('storage.category.artifacts'),
      terminal: t('storage.category.terminal'),
      diagnostics: t('storage.category.diagnostics'),
      other: t('storage.category.other'),
    },
    categoryFiles: count => t('storage.files', { count }),
    parts: {
      local: t('storage.part.local'),
      runtime: t('storage.part.runtime'),
      attachments: t('storage.part.attachments'),
      artifacts: t('storage.part.artifacts'),
      terminal: t('storage.part.terminal'),
    },
    sessionsTitle: t('storage.sessions.title'),
    sessionsCount: count => t('storage.sessions.count', { count }),
    searchPlaceholder: t('storage.search'),
    searchShortcut: t('storage.search.shortcut'),
    sortLabels: {
      reclaimable: t('storage.sort.reclaimable'),
      total: t('storage.sort.total'),
      recent: t('storage.sort.recent'),
      name: t('storage.sort.name'),
    },
    filterAll: t('storage.filter.all'),
    selectAll: t('storage.selectAll'),
    clearTranscript: t('storage.action.clearTranscript'),
    deleteSession: t('storage.action.deleteSession'),
    selected: count => t('storage.selected', { count }),
    selectionFreeable: size => t('storage.selection.freeable', { size }),
    clearSelected: t('storage.action.clearSelected'),
    deleteSelected: t('storage.action.deleteSelected'),
    empty: t('storage.empty'),
    emptyCategory: t('storage.empty.category'),
    noMatches: t('storage.noMatches'),
    error: t('storage.error'),
    active: t('storage.status.active'),
    archived: t('storage.status.archived'),
    messages: count => t('storage.messages', { count }),
    quickCleanTitle: t('storage.quickClean.title'),
    quickCleanArchivedClearDescription: (count, size) => t('storage.quickClean.archivedClearDescription', { count, size }),
    quickCleanArchivedDeleteDescription: (count, size) => t('storage.quickClean.archivedDeleteDescription', { count, size }),
    quickCleanTopClearDescription: (count, size) => t('storage.quickClean.topClearDescription', { count, size }),
    quickCleanClearArchived: t('storage.quickClean.clearArchived'),
    quickCleanDeleteArchived: t('storage.quickClean.deleteArchived'),
    quickCleanClearTop: t('storage.quickClean.clearTop'),
    confirmClearTitle: count => t('storage.confirm.clear.title', { count }),
    confirmClearDescription: t('storage.confirm.clear.description'),
    confirmDeleteTitle: count => t('storage.confirm.delete.title', { count }),
    confirmDeleteDescription: t('storage.confirm.delete.description'),
    cancel: t('storage.action.cancel'),
    confirmClear: t('storage.action.confirmClear'),
    confirmDelete: t('storage.action.confirmDelete'),
  }), [t])

  const quickActions = useMemo<StorageQuickAction[]>(() => {
    const sessions = overview.data?.sessions ?? []
    const archived = sessions.filter(session => !session.active && session.archivedAt)
    const archivedIds = archived.map(session => session.id)
    const archivedReclaimable = archived.reduce((sum, session) => sum + session.reclaimableBytes, 0)

    const top = sessions
      .filter(session => !session.active)
      .toSorted((left, right) => right.reclaimableBytes - left.reclaimableBytes)
      .slice(0, 3)
    const topIds = top.map(session => session.id)
    const topReclaimable = top.reduce((sum, session) => sum + session.reclaimableBytes, 0)

    const actions: StorageQuickAction[] = []
    if (archivedReclaimable > 0) {
      actions.push({
        id: 'clear-archived',
        action: 'purge-transcripts',
        sessionIds: archivedIds,
        reclaimableBytes: archivedReclaimable,
        title: copy.quickCleanClearArchived,
        description: copy.quickCleanArchivedClearDescription(archived.length, formatBytes(archivedReclaimable)),
      })
      actions.push({
        id: 'delete-archived',
        action: 'delete-sessions',
        sessionIds: archivedIds,
        reclaimableBytes: archivedReclaimable,
        title: copy.quickCleanDeleteArchived,
        description: copy.quickCleanArchivedDeleteDescription(archived.length, formatBytes(archivedReclaimable)),
      })
    }
    if (topReclaimable > 0) {
      actions.push({
        id: 'clear-top',
        action: 'purge-transcripts',
        sessionIds: topIds,
        reclaimableBytes: topReclaimable,
        title: copy.quickCleanClearTop,
        description: copy.quickCleanTopClearDescription(top.length, formatBytes(topReclaimable)),
      })
    }
    return actions
  }, [overview.data?.sessions, copy])

  const handleAction = (action: StorageManagerAction, sessionIds: string[]) => {
    const mutation = action === 'delete-sessions' ? remove : purge
    mutation.mutate({ body: { sessionIds } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getStorageOverviewQueryKey(), result.overview)
        const nativeWarning = result.cleanup.some(item => item.nativeStorage.status === 'failed'
          || item.nativeStorage.status === 'partial'
          || item.nativeStorage.status === 'preserved')
        toastManager.add({
          type: nativeWarning ? 'warning' : 'success',
          title: t(nativeWarning ? 'storage.toast.partial' : 'storage.toast.complete'),
        })
      },
      onError: error => toastManager.add({
        type: 'error',
        title: t('storage.toast.failed'),
        description: error instanceof Error ? error.message : String(error),
      }),
    })
  }

  return (
    <StorageManagerView
      overview={overview.data ?? null}
      copy={copy}
      quickActions={quickActions}
      loading={overview.isFetching || refresh.isPending || refreshStartedAt !== null}
      error={overview.isError}
      busy={busy}
      onRefresh={() => refresh.mutate({ path: STORAGE_MEASUREMENT_ACTIVITY })}
      onAction={handleAction}
    />
  )
}

export default StorageManager
