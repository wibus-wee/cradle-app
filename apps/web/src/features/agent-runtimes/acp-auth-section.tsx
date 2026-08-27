import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  deleteAcpAgentsByAgentIdAuthMutation,
  getAcpAgentsByAgentIdAuthMethodsOptions,
  getAcpAgentsByAgentIdAuthMethodsQueryKey,
  getSecretsOptions,
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
}: {
  agentId: string
  configuredMethodId: string | null
}) {
  const { t } = useTranslation('runtimes')
  const queryClient = useQueryClient()
  const queryOptions = getAcpAgentsByAgentIdAuthMethodsOptions({ path: { agentId } })
  const queryKey = getAcpAgentsByAgentIdAuthMethodsQueryKey({ path: { agentId } })
  const authQuery = useQuery(queryOptions)
  const needsSecrets = authQuery.data?.methods.some(method => method.kind === 'env_var') ?? false
  const secretsQuery = useQuery({
    ...getSecretsOptions(),
    enabled: needsSecrets,
  })

  const setAuth = useMutation({
    ...putAcpAgentsByAgentIdAuthMutation(),
    onSuccess: (result) => {
      queryClient.setQueryData<GetAcpAgentsByAgentIdAuthMethodsResponse>(queryKey, current => current
        ? { ...current, selectedMethodId: result.selectedMethodId }
        : current)
      queryClient.invalidateQueries({ queryKey: ACP_AGENTS_QUERY_KEY })
      toastManager.add({ type: 'success', title: t('auth.toast.saved') })
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
    envVarKind: t('auth.kind.envVar'),
    terminalKind: t('auth.kind.terminal'),
    unsupported: t('auth.unsupported'),
    optional: t('auth.optional'),
    secretPlaceholder: t('auth.secret.placeholder'),
    secretNotSet: t('auth.secret.notSet'),
    noSecrets: t('auth.secret.empty'),
    secretLoadError: t('auth.secret.error'),
    cancel: t('auth.action.cancel'),
    save: t('auth.action.save'),
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
      secrets={secretsQuery.data ?? []}
      isLoading={authQuery.isLoading}
      isSecretsLoading={needsSecrets && secretsQuery.isLoading}
      loadError={authQuery.isError}
      secretsError={secretsQuery.isError}
      pendingAction={pendingAction}
      labels={labels}
      onRetry={() => void authQuery.refetch()}
      onRetrySecrets={() => void secretsQuery.refetch()}
      onSave={({ methodId, secretRefs }) => {
        setAuth.mutate({ path: { agentId }, body: { methodId, secretRefs } })
      }}
      onClear={() => {
        clearAuth.mutate({ path: { agentId } })
      }}
      onOpenLink={openExternalLink}
    />
  )
}
