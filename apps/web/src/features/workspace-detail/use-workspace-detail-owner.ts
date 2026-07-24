import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getWorkflowRulesByWorkspaceIdOptions,
  patchWorkspacesByWorkspaceIdMutation,
  postSessionsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { runtimeComposerUsesCollapsedInput } from '~/features/agent-runtime/use-runtime-catalog'
import { describeChatExecutionError } from '~/features/chat/commands/chat-execution-errors'
import type { DraftChatComposerSubmitOptions } from '~/features/chat/composer/containers/draft-chat-composer-container'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import { readRunRuntimeSettingsPatch } from '~/features/chat/runtime/runtime-settings-presenter'
import { startOptimisticChatResponse } from '~/features/chat/session/optimistic-chat-turn'
import type { Workspace } from '~/features/workspace/types'
import { isLocalWorkspace } from '~/features/workspace/types'
import {
  sessionsQueryKey,
  updateSessionInSessionLists,
} from '~/features/workspace/use-session'
import { WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { openChatSession } from '~/navigation/navigation-commands'
import { openTearoffChatSessionWindow } from '~/navigation/tearoff-surfaces'

import { useWorkspaceFile } from './use-workspace-file'
import { SHOW_WORKSPACE_WORKFLOW_RULES } from './workspace-detail-config'
import { parseWorkspaceDetailHeadings } from './workspace-detail-toc'
import type { WorkspaceDetailTab } from './workspace-detail-types'

export function useWorkspaceDetailOwner(
  workspaceId: string,
  workspace: Workspace | null | undefined,
) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<WorkspaceDetailTab>('overview')
  const [selectedWorkflowAgentId, setSelectedWorkflowAgentId] = useState<
    string | null
  >(null)

  const agents = useWorkspaceFile(workspaceId, 'AGENTS.md')
  const { data: workflowRule } = useQuery({
    ...getWorkflowRulesByWorkspaceIdOptions({
      path: { workspaceId },
      query: selectedWorkflowAgentId ? { agentId: selectedWorkflowAgentId } : {},
    }),
    enabled: SHOW_WORKSPACE_WORKFLOW_RULES
      && activeTab === 'workflow-rules'
      && !!workspaceId,
  })
  const workflowContent = selectedWorkflowAgentId
    ? (workflowRule?.agentSpecific ?? null)
    : (workflowRule?.global ?? null)
  const workflowTocLabel = t('detail.toc.workflowRules')
  const headings = useMemo(() => {
    if (activeTab === 'overview') {
      return parseWorkspaceDetailHeadings(agents.content, 'AGENTS.md')
    }
    if (
      SHOW_WORKSPACE_WORKFLOW_RULES
      && activeTab === 'workflow-rules'
    ) {
      return parseWorkspaceDetailHeadings(workflowContent, workflowTocLabel)
    }
    return []
  }, [activeTab, agents.content, workflowContent, workflowTocLabel])

  const renameWorkspaceMutation = useMutation({
    ...patchWorkspacesByWorkspaceIdMutation(),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
      ])
    },
  })
  const createSessionMutation = useMutation({
    ...postSessionsMutation(),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      ])
    },
  })

  const handleRename = async (name: string): Promise<void> => {
    await renameWorkspaceMutation.mutateAsync({
      path: { workspaceId },
      body: { name },
    })
  }

  const openCreatedWorkspaceSession = async (
    sessionId: string,
    target: 'tab' | 'window',
  ): Promise<void> => {
    if (target === 'window') {
      const openedWindow = await openTearoffChatSessionWindow(sessionId)
      if (openedWindow) {
        return
      }
    }
    openChatSession(sessionId)
  }

  const handleDraftComposerSendToTarget = async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options: DraftChatComposerSubmitOptions,
    target: 'tab' | 'window',
  ): Promise<boolean> => {
    if (!workspace) {
      return false
    }

    const isRemoteWorkspace = !isLocalWorkspace(workspace)
    if (runtimeComposerUsesCollapsedInput(options.runtimeComposer)) {
      if (!isRemoteWorkspace && !options.agentId) {
        return false
      }

      const sessionTitle = text.slice(0, 80)
        || options.agentName
        || options.agentId
        || 'Untitled'
      const session = await createSessionMutation.mutateAsync({
        body: isRemoteWorkspace
          ? {
              workspaceId,
              title: sessionTitle,
              providerTargetId: options.providerTargetId,
              modelId: options.modelId ?? null,
              thinkingEffort: options.thinkingEffort,
              runtimeKind: options.runtimeKind,
              runtimeSettings: options.runtimeSettings,
            }
          : {
              workspaceId,
              agentId: options.agentId,
              title: sessionTitle,
              runtimeSettings: options.runtimeSettings,
            },
      })
      if (!session?.id) {
        return false
      }

      updateSessionInSessionLists(queryClient, {
        id: session.id,
        title: sessionTitle,
        workspaceId,
        agentId: isRemoteWorkspace ? null : options.agentId,
        runtimeKind: options.runtimeKind,
      }, { promote: true })
      await openCreatedWorkspaceSession(session.id, target)
      return true
    }

    if (!isRemoteWorkspace && !options.providerTargetId) {
      return false
    }

    const sessionTitle = text.slice(0, 80)
      || options.providerTargetName
      || options.providerTargetId
      || 'Untitled'
    const session = await createSessionMutation.mutateAsync({
      body: isRemoteWorkspace
        ? {
            workspaceId,
            runtimeKind: options.runtimeKind,
            title: sessionTitle,
            providerTargetId: options.providerTargetId,
            modelId: options.modelId ?? null,
            thinkingEffort: options.thinkingEffort,
            runtimeSettings: options.runtimeSettings,
          }
        : {
            workspaceId,
            providerTargetId: options.providerTargetId,
            modelId: options.modelId ?? null,
            runtimeKind: options.runtimeKind,
            title: sessionTitle,
            runtimeSettings: options.runtimeSettings,
          },
    })
    if (!session?.id) {
      return false
    }

    updateSessionInSessionLists(queryClient, {
      id: session.id,
      title: sessionTitle,
      workspaceId,
      providerTargetId: options.providerTargetId ?? null,
      modelId: options.modelId ?? null,
      runtimeKind: options.runtimeKind,
    }, { promote: true })
    await openCreatedWorkspaceSession(session.id, target)

    startOptimisticChatResponse({
      sessionId: session.id,
      queryClient,
      body: {
        text,
        files,
        contextParts,
        providerTargetId: options.providerTargetId,
        modelId: options.modelId,
        thinkingEffort: options.thinkingEffort,
        runtimeSettings: readRunRuntimeSettingsPatch(options.runtimeSettings),
      },
      onAccepted: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        ])
      },
      onError: (error) => {
        toastManager.add({
          type: 'error',
          title: t('detail.toast.startChatFailed'),
          description: describeChatExecutionError(error)
            ?? (error instanceof Error ? error.message : String(error)),
        })
      },
      onSettled: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        ])
      },
    })
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
    ])
    return true
  }

  const handleDraftComposerSend = (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options: DraftChatComposerSubmitOptions,
  ): Promise<boolean> => {
    return handleDraftComposerSendToTarget(
      text,
      files,
      contextParts,
      options,
      'tab',
    )
  }
  const handleDraftComposerSendInNewWindow = (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options: DraftChatComposerSubmitOptions,
  ): Promise<boolean> => {
    return handleDraftComposerSendToTarget(
      text,
      files,
      contextParts,
      options,
      'window',
    )
  }

  return {
    activeTab,
    agents,
    handleDraftComposerSend,
    handleDraftComposerSendInNewWindow,
    handleRename,
    headings,
    selectedWorkflowAgentId,
    setActiveTab,
    setSelectedWorkflowAgentId,
    workspace,
    workspaceId,
  }
}
