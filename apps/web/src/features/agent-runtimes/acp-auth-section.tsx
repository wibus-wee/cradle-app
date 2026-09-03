import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  deleteAcpAgentsByAgentIdAuthMutation,
  getAcpAgentsByAgentIdAuthMethodsOptions,
  getAcpAgentsByAgentIdAuthMethodsQueryKey,
  putAcpAgentsByAgentIdAuthMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetAcpAgentsByAgentIdAuthMethodsResponse } from '~/api-gen/types.gen'
import { toastManager } from '~/components/ui/toast'
import { nativeIpc } from '~/lib/electron'

import type { AcpAuthViewLabels } from './acp-auth-view'
import { AcpAuthView } from './acp-auth-view'
import { ACP_AGENTS_QUERY_KEY } from './use-acp-registry'

function openExternalLink(url: string) {
  const openExternal = nativeIpc?.native?.openExternal
  if (openExternal) {
    void openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function AcpAuthSection({
  agentId,
  configuredMethodId,
  onSaved,
}: {
  agentId: string
  configuredMethodId: string | null
  onSaved?: () => void
}) {
  const { t } = useTranslation('runtimes')
  const queryClient = useQueryClient()
  const queryOptions = getAcpAgentsByAgentIdAuthMethodsOptions({ path: { agentId } })
  const queryKey = getAcpAgentsByAgentIdAuthMethodsQueryKey({ path: { agentId } })
  const authQuery = useQuery(queryOptions)

  const setAuth = useMutation({
    ...putAcpAgentsByAgentIdAuthMutation(),
    onSuccess: (result) => {
      queryClient.setQueryData<GetAcpAgentsByAgentIdAuthMethodsResponse>(queryKey, current => current
        ? { ...current, selectedMethodId: result.selectedMethodId }
        : current)
      queryClient.invalidateQueries({ queryKey: ACP_AGENTS_QUERY_KEY })
      toastManager.add({ type: 'success', title: t('auth.toast.saved') })
      onSaved?.()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('auth.toast.saveError') })
    },
  })

  const clearAuth = useMutation({
    ...deleteAcpAgentsByAgentIdAuthMutation(),
    onSuccess: (result) => {
      queryClient.setQueryData<GetAcpAgentsByAgentIdAuthMethodsResponse>(queryKey, current => current
        ? { ...current, selectedMethodId: result.selectedMethodId }
        : current)
      queryClient.invalidateQueries({ queryKey: ACP_AGENTS_QUERY_KEY })
      toastManager.add({ type: 'success', title: t('auth.toast.cleared') })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('auth.toast.clearError') })
    },
  })

  const labels: AcpAuthViewLabels = {
    title: t('auth.title'),
    loading: t('auth.loading'),
    loadErrorTitle: t('auth.error.title'),
    loadErrorDescription: t('auth.error.description'),
    retry: t('error.retry'),
    noMethods: t('auth.empty'),
    configuredPrefix: t('auth.configuredPrefix'),
    configuredUnavailable: t('auth.configuredUnavailable'),
    change: t('auth.action.change'),
    clear: t('auth.action.clear'),
    clearing: t('auth.action.clearing'),
    methodLabel: t('auth.methodLabel'),
    agentKind: t('auth.kind.agent'),
    terminalKind: t('auth.kind.terminal'),
    unsupported: t('auth.unsupported'),
    cancel: t('auth.action.cancel'),
    authenticate: t('auth.action.authenticate'),
    saving: t('auth.action.saving'),
  }

  const pendingAction = setAuth.isPending ? 'save' : clearAuth.isPending ? 'clear' : null
  const selectedMethodId = authQuery.data
    ? authQuery.data.selectedMethodId
    : configuredMethodId

  return (
    <AcpAuthView
      key={selectedMethodId ?? 'unconfigured'}
      methods={authQuery.data?.methods ?? []}
      selectedMethodId={selectedMethodId}
      isLoading={authQuery.isLoading}
      loadError={authQuery.isError}
      pendingAction={pendingAction}
      labels={labels}
      onRetry={() => void authQuery.refetch()}
      onSave={({ methodId }) => {
        setAuth.mutate({ path: { agentId }, body: { methodId } })
      }}
      onClear={() => {
        clearAuth.mutate({ path: { agentId } })
      }}
      onOpenLink={openExternalLink}
    />
  )
}
