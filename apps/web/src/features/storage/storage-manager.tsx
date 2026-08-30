import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getStorageOverviewOptions,
  getStorageOverviewQueryKey,
  postStorageSessionsDeleteMutation,
  postStorageSessionsPurgeTranscriptsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'

import type { StorageManagerAction, StorageManagerCopy } from './storage-manager-view'
import { StorageManagerView } from './storage-manager-view'

export function StorageManager() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const overview = useQuery(getStorageOverviewOptions())
  const purge = useMutation(postStorageSessionsPurgeTranscriptsMutation())
  const remove = useMutation(postStorageSessionsDeleteMutation())
  const busy = purge.isPending || remove.isPending

  const copy = useMemo<StorageManagerCopy>(() => ({
    title: t('storage.page.title'),
    description: t('storage.page.description'),
    totalUsed: t('storage.totalUsed'),
    measuredNow: t('storage.measuredNow'),
    refresh: t('storage.action.refresh'),
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
    sessionsTitle: t('storage.sessions.title'),
    sessionsCount: count => t('storage.sessions.count', { count }),
    searchPlaceholder: t('storage.search'),
    largestFirst: t('storage.sort.size'),
    recentFirst: t('storage.sort.recent'),
    selectAll: t('storage.selectAll'),
    clearTranscript: t('storage.action.clearTranscript'),
    deleteSession: t('storage.action.deleteSession'),
    selected: count => t('storage.selected', { count }),
    clearSelected: t('storage.action.clearSelected'),
    deleteSelected: t('storage.action.deleteSelected'),
    empty: t('storage.empty'),
    noMatches: t('storage.noMatches'),
    error: t('storage.error'),
    active: t('storage.status.active'),
    archived: t('storage.status.archived'),
    messages: count => t('storage.messages', { count }),
    localData: t('storage.part.local'),
    runtimeData: t('storage.part.runtime'),
    attachments: t('storage.part.attachments'),
    artifacts: t('storage.part.artifacts'),
    terminal: t('storage.part.terminal'),
    confirmClearTitle: count => t('storage.confirm.clear.title', { count }),
    confirmClearDescription: t('storage.confirm.clear.description'),
    confirmDeleteTitle: count => t('storage.confirm.delete.title', { count }),
    confirmDeleteDescription: t('storage.confirm.delete.description'),
    cancel: t('storage.action.cancel'),
    confirmClear: t('storage.action.confirmClear'),
    confirmDelete: t('storage.action.confirmDelete'),
  }), [t])

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
      loading={overview.isFetching}
      error={overview.isError}
      busy={busy}
      onRefresh={() => void overview.refetch()}
      onAction={handleAction}
    />
  )
}

export default StorageManager
