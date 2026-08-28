import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { toastManager } from '~/components/ui/toast'
import type { Agent } from '~/features/agent-runtime/use-agents'

import { AcpAuthSection } from './acp-auth-section'
import type {
  AcpLocalAgentDraft,
  AcpLocalAgentSaveInput,
  AcpLocalAgentViewLabels,
} from './acp-local-agent-view'
import { AcpLocalAgentView } from './acp-local-agent-view'
import type { AcpInstalledAgent, AcpLocalDistributionType } from './use-acp-registry'
import { useAcpAgentMutations } from './use-acp-registry'
import { CreateAgentButton, UsedBySection } from './used-by-section'

const StringArraySchema = z.array(z.string())
const StringRecordSchema = z.record(z.string(), z.string())

function errorMessage(error: Error): string {
  return error.message
}

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return []
  }
  try {
    return StringArraySchema.parse(JSON.parse(value))
  }
  catch {
    return []
  }
}

function parseStringRecord(value: string | null): Record<string, string> {
  if (!value) {
    return {}
  }
  try {
    return StringRecordSchema.parse(JSON.parse(value))
  }
  catch {
    return {}
  }
}

function formatEnvironment(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')
}

function initialDraft(agent?: AcpInstalledAgent): AcpLocalAgentDraft {
  const distributionType: AcpLocalDistributionType = agent?.distributionType === 'npx'
    || agent?.distributionType === 'uvx'
    ? agent.distributionType
    : 'command'
  return {
    name: agent?.name ?? '',
    distributionType,
    command: agent?.cmd ?? '',
    argumentsText: parseStringArray(agent?.args ?? null).join('\n'),
    environmentText: formatEnvironment(parseStringRecord(agent?.env ?? null)),
  }
}

function useLabels(): AcpLocalAgentViewLabels {
  const { t } = useTranslation('runtimes')
  return {
    createTitle: t('local.createTitle'),
    editTitle: t('local.editTitle'),
    localChip: t('local.chip'),
    name: t('local.name'),
    namePlaceholder: t('local.namePlaceholder'),
    launchMethod: t('local.launchMethod'),
    launchMethodCommand: t('local.launchMethod.command'),
    launchMethodNpx: t('local.launchMethod.npx'),
    launchMethodUvx: t('local.launchMethod.uvx'),
    command: t('local.command'),
    packageName: t('local.packageName'),
    commandPlaceholder: t('local.commandPlaceholder'),
    npxPlaceholder: t('local.npxPlaceholder'),
    uvxPlaceholder: t('local.uvxPlaceholder'),
    arguments: t('local.arguments'),
    argumentsDescription: t('local.argumentsDescription'),
    argumentsPlaceholder: t('local.argumentsPlaceholder'),
    environment: t('local.environment'),
    environmentDescription: t('local.environmentDescription'),
    environmentPlaceholder: t('local.environmentPlaceholder'),
    environmentInvalid: t('local.environmentInvalid'),
    save: t('local.action.save'),
    saving: t('local.action.saving'),
    create: t('local.action.create'),
    creating: t('local.action.creating'),
    delete: t('local.action.delete'),
    deleting: t('local.action.deleting'),
    deleteTitle: t('local.delete.title'),
    deleteDescription: t('local.delete.description'),
    deleteCancel: t('local.delete.cancel'),
    deleteConfirm: t('local.delete.confirm'),
    cancel: t('local.action.cancel'),
  }
}

export function AcpLocalAgentDetail({
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
  const { createLocalAgent, updateLaunchConfig, uninstallAgent } = useAcpAgentMutations()
  const mode = agent ? 'edit' : 'create'

  const handleSave = (input: AcpLocalAgentSaveInput) => {
    if (!agent) {
      createLocalAgent.mutate(
        { body: input },
        {
          onSuccess: (created) => {
            toastManager.add({ type: 'success', title: t('local.toast.created', { name: created.name }) })
            onCreated(created.id)
          },
          onError: error => toastManager.add({
            type: 'error',
            title: t('local.toast.createError'),
            description: errorMessage(error),
          }),
        },
      )
      return
    }

    updateLaunchConfig.mutate(
      {
        path: { agentId: agent.id },
        body: input,
      },
      {
        onSuccess: updated => toastManager.add({
          type: 'success',
          title: t('local.toast.saved', { name: updated.name }),
        }),
        onError: error => toastManager.add({
          type: 'error',
          title: t('local.toast.saveError'),
          description: errorMessage(error),
        }),
      },
    )
  }

  const handleDelete = () => {
    if (!agent) {
      return
    }
    uninstallAgent.mutate(
      { path: { agentId: agent.id } },
      {
        onSuccess: () => {
          toastManager.add({ type: 'success', title: t('local.toast.deleted', { name: agent.name }) })
          onDeleted()
        },
        onError: error => toastManager.add({
          type: 'error',
          title: t('local.toast.deleteError'),
          description: errorMessage(error),
        }),
      },
    )
  }

  return (
    <AcpLocalAgentView
      key={agent?.id ?? 'create'}
      mode={mode}
      agentId={agent?.id}
      initialDraft={initialDraft(agent)}
      labels={labels}
      isSaving={createLocalAgent.isPending || updateLaunchConfig.isPending}
      isDeleting={uninstallAgent.isPending}
      error={null}
      deleteInUseMessage={usedByAgents.length > 0
        ? t('local.delete.inUse', { count: usedByAgents.length })
        : undefined}
      onSave={handleSave}
      onDelete={agent ? handleDelete : undefined}
      onCancel={onCancel}
      supplementary={agent
        ? (
            <>
              <AcpAuthSection agentId={agent.id} configuredMethodId={agent.authMethodId} />
              <UsedBySection agents={usedByAgents} />
              <div>
                <CreateAgentButton runtimeKind="acp-chat" acpAgentId={agent.id} />
              </div>
            </>
          )
        : undefined}
    />
  )
}
