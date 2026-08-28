import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getSecretsOptions } from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import type { Agent } from '~/features/agent-runtime/use-agents'

import { AcpAuthSection } from './acp-auth-section'
import type {
  AcpRemoteAgentDraft,
  AcpRemoteAgentSaveInput,
  AcpRemoteAgentViewLabels,
} from './acp-remote-agent-view'
import { AcpRemoteAgentView } from './acp-remote-agent-view'
import type { AcpInstalledAgent } from './use-acp-registry'
import { useAcpAgentMutations } from './use-acp-registry'
import { CreateAgentButton, UsedBySection } from './used-by-section'

function initialDraft(agent?: AcpInstalledAgent): AcpRemoteAgentDraft {
  return {
    name: agent?.name ?? '',
    connectionType: agent?.connectionType === 'websocket' ? 'websocket' : 'http',
    endpointUrl: agent?.endpointUrl ?? '',
    headers: Object.entries(agent?.remoteHeadersSecretRefs ?? {}).map(([name, secretId], index) => ({
      id: `${index}:${name}`,
      name,
      secretId,
    })),
  }
}

function useLabels(): AcpRemoteAgentViewLabels {
  const { t } = useTranslation('runtimes')
  return {
    createTitle: t('remote.createTitle'),
    editTitle: t('remote.editTitle'),
    remoteChip: t('remote.chip'),
    name: t('remote.name'),
    namePlaceholder: t('remote.namePlaceholder'),
    transport: t('remote.transport'),
    http: t('remote.transport.http'),
    websocket: t('remote.transport.websocket'),
    endpoint: t('remote.endpoint'),
    endpointPlaceholderHttp: t('remote.endpointPlaceholder.http'),
    endpointPlaceholderWebsocket: t('remote.endpointPlaceholder.websocket'),
    endpointDescription: t('remote.endpointDescription'),
    headers: t('remote.headers'),
    headersDescription: t('remote.headersDescription'),
    headerName: t('remote.headerName'),
    headerNamePlaceholder: t('remote.headerNamePlaceholder'),
    secret: t('remote.secret'),
    secretPlaceholder: t('remote.secretPlaceholder'),
    noSecrets: t('remote.noSecrets'),
    addHeader: t('remote.action.addHeader'),
    removeHeader: t('remote.action.removeHeader'),
    duplicateHeader: t('remote.error.duplicateHeader'),
    incompleteHeader: t('remote.error.incompleteHeader'),
    save: t('remote.action.save'),
    saving: t('remote.action.saving'),
    create: t('remote.action.create'),
    creating: t('remote.action.creating'),
    delete: t('remote.action.delete'),
    deleting: t('remote.action.deleting'),
    deleteTitle: t('remote.delete.title'),
    deleteDescription: t('remote.delete.description'),
    deleteCancel: t('remote.delete.cancel'),
    deleteConfirm: t('remote.delete.confirm'),
    cancel: t('remote.action.cancel'),
  }
}

export function AcpRemoteAgentDetail({
  agent,
  usedByAgents,
  onCreated,
  onDeleted,
  onCancel,
}: {
  agent?: AcpInstalledAgent
  usedByAgents: Agent[]
  onCreated: (agentId: string) => void
  onDeleted: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('runtimes')
  const labels = useLabels()
  const secretsQuery = useQuery(getSecretsOptions())
  const { createRemoteAgent, updateRemoteConfig, uninstallAgent } = useAcpAgentMutations()
  const mode = agent ? 'edit' : 'create'

  const handleSave = (input: AcpRemoteAgentSaveInput) => {
    if (!agent) {
      createRemoteAgent.mutate(
        { body: input },
        {
          onSuccess: (created) => {
            toastManager.add({ type: 'success', title: t('remote.toast.created', { name: created.name }) })
            onCreated(created.id)
          },
          onError: error => toastManager.add({
            type: 'error',
            title: t('remote.toast.createError'),
            description: error.message,
          }),
        },
      )
      return
    }

    updateRemoteConfig.mutate(
      { path: { agentId: agent.id }, body: input },
      {
        onSuccess: updated => toastManager.add({
          type: 'success',
          title: t('remote.toast.saved', { name: updated.name }),
        }),
        onError: error => toastManager.add({
          type: 'error',
          title: t('remote.toast.saveError'),
          description: error.message,
        }),
      },
    )
  }

  const handleDelete = () => {
    if (!agent) { return }
    uninstallAgent.mutate(
      { path: { agentId: agent.id } },
      {
        onSuccess: () => {
          toastManager.add({ type: 'success', title: t('remote.toast.deleted', { name: agent.name }) })
          onDeleted()
        },
        onError: error => toastManager.add({
          type: 'error',
          title: t('remote.toast.deleteError'),
          description: error.message,
        }),
      },
    )
  }

  return (
    <AcpRemoteAgentView
      key={agent?.id ?? 'create'}
      mode={mode}
      agentId={agent?.id}
      initialDraft={initialDraft(agent)}
      secrets={secretsQuery.data ?? []}
      isSecretsLoading={secretsQuery.isLoading}
      labels={labels}
      isSaving={createRemoteAgent.isPending || updateRemoteConfig.isPending}
      isDeleting={uninstallAgent.isPending}
      error={secretsQuery.isError ? t('remote.error.secrets') : null}
      deleteInUseMessage={usedByAgents.length > 0 ? t('remote.delete.inUse', { count: usedByAgents.length }) : undefined}
      onSave={handleSave}
      onDelete={agent ? handleDelete : undefined}
      onCancel={onCancel}
      supplementary={agent
        ? (
            <>
              <AcpAuthSection agentId={agent.id} configuredMethodId={agent.authMethodId} />
              <UsedBySection agents={usedByAgents} />
              <div><CreateAgentButton runtimeKind="acp-chat" acpAgentId={agent.id} /></div>
            </>
          )
        : undefined}
    />
  )
}
