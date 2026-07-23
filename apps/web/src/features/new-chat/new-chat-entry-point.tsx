import { useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { postSessions, postSessionsByIdIsolationStart } from '~/api-gen/sdk.gen'
import type { PostSessionsData } from '~/api-gen/types.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { runtimeComposerUsesCollapsedInput, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { describeChatExecutionError } from '~/features/chat/commands/chat-execution-errors'
import type { DraftChatComposerSubmitOptions } from '~/features/chat/composer/draft-chat-composer'
import { DraftChatComposerWithState } from '~/features/chat/composer/draft-chat-composer'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import {
  isPlanRuntimeSettings,
  mergeRuntimeSettings,
  readDefaultRuntimeSettings,
  readRunRuntimeSettingsPatch,
  resolveRuntimeCatalogItem,
} from '~/features/chat/runtime/runtime-settings-presenter'
import { startOptimisticChatResponse } from '~/features/chat/session/optimistic-chat-turn'
import { useComposerState } from '~/features/composer-toolbar'
import type { IssueIsolationStartChoice } from '~/features/new-chat/issue-isolation-start-dialog'
import { IssueIsolationStartDialog } from '~/features/new-chat/issue-isolation-start-dialog'
import {
  useIssueIsolationContext,
} from '~/features/session/use-session-isolation'
import { getLocalWorkspacePath, isLocalWorkspace } from '~/features/workspace/types'
import { sessionsQueryKey, updateSessionInSessionLists, useWorkspaceSessions } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces, WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { openChatSession } from '~/navigation/navigation-commands'
import { openTearoffChatSessionWindow } from '~/navigation/tearoff-surfaces'
import { useNewChatStore } from '~/store/new-chat'

import { NewChatQuickActionsView } from './new-chat-quick-actions-view'
import { NewChatSurfaceView } from './new-chat-surface-view'
import { NewChatWorkspaceSelectorView } from './new-chat-workspace-selector-view'

/* ─── Constants ───────────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { labelKey: 'quick.explain.label', promptKey: 'quick.explain.prompt' },
  { labelKey: 'quick.risk.label', promptKey: 'quick.risk.prompt' },
  { labelKey: 'quick.fixTest.label', promptKey: 'quick.fixTest.prompt' },
  { labelKey: 'quick.notes.label', promptKey: 'quick.notes.prompt' },
  { labelKey: 'quick.refactor.label', promptKey: 'quick.refactor.prompt' },
] as const

type CreateSessionBody = PostSessionsData['body'] & {
  runtimeSettings?: DraftChatComposerSubmitOptions['runtimeSettings']
}

/* ─── Owner Hook ──────────────────────────────────────────────────────── */

function useNewChatPageOwner(
  active: boolean,
  replaceCurrentSurfaceOnSubmit: boolean,
  issueId: string | null = null,
  initialWorkspaceId: string | null = null,
  sessionGroupId: string | null = null,
) {
  const { t } = useTranslation('new-chat')
  const issueIsolationContext = useIssueIsolationContext(issueId)
  const [isolationDialogOpen, setIsolationDialogOpen] = useState(false)
  const pendingSendRef = useRef<{
    text: string
    files: FileUIPart[]
    contextParts: ChatContextPart[]
    options: DraftChatComposerSubmitOptions
    target: 'tab' | 'window'
  } | null>(null)
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const { addFromPicker, adding: addingWorkspace } = useAddWorkspace()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState('')
  const [quickActionText, setQuickActionText] = useState<string | undefined>(undefined)
  const [quickActionKey, setQuickActionKey] = useState(0)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() => {
    if (initialWorkspaceId) {
      return initialWorkspaceId
    }
    try {
      return localStorage.getItem('cradle:lastWorkspaceId')
    }
    catch {
      return null
    }
  })

  useEffect(() => {
    try {
      if (selectedWorkspaceId) {
        localStorage.setItem('cradle:lastWorkspaceId', selectedWorkspaceId)
      }
      else {
        localStorage.removeItem('cradle:lastWorkspaceId')
      }
    }
    catch {}
  }, [selectedWorkspaceId])

  const selectedProjectWorkspaceId = useMemo(() => {
    if (selectedWorkspaceId && workspaces.some(w => w.id === selectedWorkspaceId)) {
      return selectedWorkspaceId
    }
    return null
  }, [selectedWorkspaceId, workspaces])

  const selectedWorkspace = workspaces.find(w => w.id === selectedProjectWorkspaceId) ?? null
  const selectedWorkspaceLocalPath = getLocalWorkspacePath(selectedWorkspace)
  const remoteHostId = selectedWorkspace && !isLocalWorkspace(selectedWorkspace)
    ? selectedWorkspace.locator.hostId
    : null
  const composerState = useComposerState({
    context: 'new-chat',
    workspaceId: selectedProjectWorkspaceId,
    remoteHostId,
    // Remote hosts own their provider catalog; local Agents are not executable there.
    enableAgents: !remoteHostId,
  })
  const { loading: sessionsLoading } = useWorkspaceSessions(selectedProjectWorkspaceId)
  const sessionsReady = selectedProjectWorkspaceId === null || !sessionsLoading
  const isReady = !workspacesLoading
    && sessionsReady
  const promptInputCollapsed = composerState.selection.targetMode === 'agent'
    && runtimeComposerUsesCollapsedInput(composerState.runtimeComposer)

  const openCreatedChatSession = useCallback(async (sessionId: string, target: 'tab' | 'window') => {
    if (target === 'window') {
      const openedWindow = await openTearoffChatSessionWindow(sessionId)
      if (openedWindow) {
        return
      }
    }
    openChatSession(sessionId, { replace: replaceCurrentSurfaceOnSubmit })
  }, [replaceCurrentSurfaceOnSubmit])

  const executeSendToTarget = useCallback(async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[] = [],
    options: DraftChatComposerSubmitOptions,
    target: 'tab' | 'window' = 'tab',
    isolation?: { choice: IssueIsolationStartChoice, worktreeId?: string },
  ) => {
    const trimmedText = text.trim()
    try {
      const linkedIssueFields = issueId ? { linkedIssueId: issueId } : {}
      const sessionGroupFields = sessionGroupId ? { sessionGroupId } : {}
      const worktreeFields = isolation?.choice === 'continue' && isolation.worktreeId
        ? { worktreeId: isolation.worktreeId }
        : {}

      if (runtimeComposerUsesCollapsedInput(options.runtimeComposer)) {
        if (!options.agentId) {
          return false
        }
        const body: CreateSessionBody = {
          ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
          title: trimmedText.slice(0, 80) || options.agentName || options.agentId,
          agentId: options.agentId,
          runtimeSettings: options.runtimeSettings,
          ...linkedIssueFields,
          ...sessionGroupFields,
          ...worktreeFields,
        }
        const { data: sessionData } = await postSessions({
          body,
        })
        const session = sessionData as { id: string, workspaceId: string | null } | null
        if (!session?.id) {
          return false
        }
        if (isolation?.choice === 'new-isolated') {
          await postSessionsByIdIsolationStart({
            path: { id: session.id },
            body: { slug: body.title ?? 'isolated' },
          })
        }
        updateSessionInSessionLists(queryClient, {
          id: session.id,
          title: trimmedText.slice(0, 80) || options.agentName || options.agentId,
          workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
          agentId: options.agentId,
          runtimeKind: options.runtimeKind,
          sessionGroupId,
        }, { promote: true })
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
        ])
        await openCreatedChatSession(session.id, target)
        return true
      }

      const isRemoteWorkspace = !!selectedWorkspace && !isLocalWorkspace(selectedWorkspace)
      if (
        !isRemoteWorkspace
        && !options.providerTargetId
        && !options.agentId
        && !options.acpAgentId
        && options.providerBinding !== 'runtime-owned'
      ) {
        return false
      }
      const sessionTitle = trimmedText.slice(0, 80)
        || options.agentName
        || options.acpAgentName
        || options.providerTargetName
        || options.agentId
        || options.acpAgentId
        || options.providerTargetId
        || 'Untitled'
      // Remote provider ids come from the remote catalog and are forwarded through
      // the local projection endpoint. They are never resolved as local providers.
      const body: CreateSessionBody = isRemoteWorkspace
        ? {
            ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
            title: sessionTitle,
            providerTargetId: options.providerTargetId,
            modelId: options.modelId ?? null,
            thinkingEffort: options.thinkingEffort,
            runtimeKind: options.runtimeKind,
            runtimeSettings: options.runtimeSettings,
            ...linkedIssueFields,
            ...sessionGroupFields,
            ...worktreeFields,
          }
        : options.agentId
          ? {
              ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
              title: sessionTitle,
              agentId: options.agentId,
              runtimeSettings: options.runtimeSettings,
              ...linkedIssueFields,
              ...sessionGroupFields,
              ...worktreeFields,
            }
          : options.acpAgentId
            ? {
                ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
                title: sessionTitle,
                acpAgentId: options.acpAgentId,
                acpDraftSessionId: options.acpDraftSessionId,
                modelId: options.modelId ?? null,
                runtimeKind: options.runtimeKind,
                runtimeSettings: options.runtimeSettings,
                ...linkedIssueFields,
                ...sessionGroupFields,
                ...worktreeFields,
              }
          : {
              ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
              title: sessionTitle,
              providerTargetId: options.providerTargetId,
              modelId: options.modelId ?? null,
              runtimeKind: options.runtimeKind,
              runtimeSettings: options.runtimeSettings,
              ...linkedIssueFields,
              ...sessionGroupFields,
              ...worktreeFields,
            }
      const { data: sessionData } = await postSessions({
        body,
      })
      const session = sessionData as { id: string, workspaceId: string | null } | null
      if (!session?.id) {
        return false
      }
      if (isolation?.choice === 'new-isolated') {
        await postSessionsByIdIsolationStart({
          path: { id: session.id },
          body: { slug: sessionTitle },
        })
      }
      updateSessionInSessionLists(queryClient, {
        id: session.id,
        title: sessionTitle,
        workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
        agentId: options.agentId ?? null,
        providerTargetId: options.providerTargetId,
        modelId: options.modelId ?? null,
        runtimeKind: options.runtimeKind,
        sessionGroupId,
      }, { promote: true })
      startOptimisticChatResponse({
        sessionId: session.id,
        queryClient,
        body: {
          text: trimmedText,
          files,
          contextParts,
          modelId: options.modelId,
          thinkingEffort: options.thinkingEffort,
          runtimeSettings: readRunRuntimeSettingsPatch(options.runtimeSettings),
        },
        onAccepted: () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) }),
            queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
          ])
        },
        onError: (err) => {
          console.error('[NewChatPage] start response failed:', describeChatExecutionError(err) ?? err)
        },
      })
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
      ])
      await openCreatedChatSession(session.id, target)
      return true
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', describeChatExecutionError(err) ?? err)
      return false
    }
  }, [issueId, openCreatedChatSession, queryClient, selectedProjectWorkspaceId, selectedWorkspace, sessionGroupId])

  const handleSendToTarget = useCallback(async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[] = [],
    options: DraftChatComposerSubmitOptions,
    target: 'tab' | 'window' = 'tab',
    isolation?: { choice: IssueIsolationStartChoice, worktreeId?: string },
  ) => {
    if (
      issueId
      && !isolation
      && (issueIsolationContext.data?.groups.length ?? 0) > 0
    ) {
      pendingSendRef.current = { text, files, contextParts, options, target }
      setIsolationDialogOpen(true)
      return false
    }
    return executeSendToTarget(text, files, contextParts, options, target, isolation)
  }, [executeSendToTarget, issueId, issueIsolationContext.data?.groups.length])

  const handleIsolationDialogConfirm = useCallback((choice: IssueIsolationStartChoice, worktreeId?: string) => {
    const pending = pendingSendRef.current
    pendingSendRef.current = null
    setIsolationDialogOpen(false)
    if (!pending) {
      return
    }
    void handleSendToTarget(
      pending.text,
      pending.files,
      pending.contextParts,
      pending.options,
      pending.target,
      { choice, worktreeId },
    )
  }, [handleSendToTarget])

  const dismissIsolationDialog = useCallback(() => {
    pendingSendRef.current = null
    setIsolationDialogOpen(false)
  }, [])

  const handleSend = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[], options: DraftChatComposerSubmitOptions) => {
    return handleSendToTarget(text, files, contextParts, options, 'tab')
  }, [handleSendToTarget])

  const handleSendInNewWindow = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[], options: DraftChatComposerSubmitOptions) => {
    return handleSendToTarget(text, files, contextParts, options, 'window')
  }, [handleSendToTarget])

  const handleSendIsolated = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[], options: DraftChatComposerSubmitOptions) => {
    return handleSendToTarget(text, files, contextParts, options, 'tab', { choice: 'new-isolated' })
  }, [handleSendToTarget])

  const handleQuickAction = useCallback((prompt: string) => {
    setQuickActionText(prompt)
    setQuickActionKey(key => key + 1)
  }, [])

  return {
    draft,
    composerState,
    handleQuickAction,
    handleSend,
    handleSendInNewWindow,
    handleSendIsolated,
    handleIsolationDialogConfirm,
    dismissIsolationDialog,
    isolationDialogOpen,
    issueIsolationGroups: issueIsolationContext.data?.groups ?? [],
    isReady,
    selectedWorkspace,
    selectedProjectWorkspaceId,
    selectedWorkspaceLocalPath,
    remoteHostId,
    setDraft,
    promptInputCollapsed,
    addFromPicker,
    addingWorkspace,
    setSelectedWorkspaceId,
    t,
    quickActionKey,
    quickActionText,
    workspaces,
  }
}

/* ─── Composer Card ───────────────────────────────────────────────────── */

function NewChatComposerCard({
  active,
  owner,
  testIdPrefix = 'new-chat',
}: {
  active: boolean
  owner: ReturnType<typeof useNewChatPageOwner>
  testIdPrefix?: string
}) {
  const {
    handleSend,
    handleSendInNewWindow,
    handleSendIsolated,
    quickActionKey,
    quickActionText,
    addFromPicker,
    addingWorkspace,
    setSelectedWorkspaceId,
    setDraft,
    selectedWorkspace,
    t,
    workspaces,
  } = owner

  const workspaceSelector = (
    <NewChatWorkspaceSelectorView
      selectedWorkspace={selectedWorkspace}
      workspaces={workspaces}
      groupLabel={t('workspace.group')}
      adhocLabel={t('workspace.adhoc')}
      addProjectLabel={t('workspace.addProject')}
      addingProjectLabel={t('workspace.adding')}
      addingProject={addingWorkspace}
      onSelectWorkspace={setSelectedWorkspaceId}
      onAddProject={() => void addFromPicker()}
    />
  )

  return (
    <DraftChatComposerWithState
      composerState={owner.composerState}
      workspaceId={selectedWorkspace?.id ?? null}
      remoteHostId={owner.remoteHostId}
      active={active}
      contextBar={workspaceSelector}
      onSendIsolated={handleSendIsolated}
      replaceText={quickActionText}
      replaceTextKey={quickActionKey}
      onDraftChange={setDraft}
      onSend={handleSend}
      onSendInNewWindow={handleSendInNewWindow}
      testIdPrefix={testIdPrefix}
    />
  )
}

/* ─── Main Component ──────────────────────────────────────────────────── */

function NewChatLayoutSlots({
  hasAside,
  hasBrowserPanel,
  workspaceId,
}: {
  hasAside: boolean
  hasBrowserPanel: boolean
  workspaceId: string | null
}) {
  'use no memo'

  useRegisterLayoutSlots('new-chat', useMemo(() => ({
    asideWorkspaceId: hasAside ? workspaceId : null,
    hasAside,
    hasBrowserPanel,
  }), [hasAside, hasBrowserPanel, workspaceId]))

  return null
}

interface NewChatEntryPointProps {
  active?: boolean
  dataTestId?: string
  includeLayoutSlots?: boolean
  replaceCurrentSurfaceOnSubmit?: boolean
  testIdPrefix?: string
  issueId?: string | null
  initialWorkspaceId?: string | null
  sessionGroupId?: string | null
}

export function NewChatEntryPoint({
  active = true,
  dataTestId = 'new-chat-page',
  includeLayoutSlots = true,
  replaceCurrentSurfaceOnSubmit = true,
  testIdPrefix = 'new-chat',
  issueId = null,
  initialWorkspaceId = null,
  sessionGroupId = null,
}: NewChatEntryPointProps) {
  const owner = useNewChatPageOwner(
    active,
    replaceCurrentSurfaceOnSubmit,
    issueId,
    initialWorkspaceId,
    sessionGroupId,
  )
  const hasWorkspace = !!owner.selectedWorkspace
  const hasLocalWorkspace = !!owner.selectedWorkspaceLocalPath
  const { runtimes } = useRuntimeCatalog()
  const runtimeKind = owner.composerState.selection.runtimeKind
  const storedRuntimeSettings = useNewChatStore(s => s.lastRuntimeSettingsByKind[runtimeKind])
  const isPlanMode = useMemo(() => {
    const runtime = resolveRuntimeCatalogItem(runtimes, runtimeKind)
    const defaults = readDefaultRuntimeSettings(runtime)
    return isPlanRuntimeSettings(mergeRuntimeSettings(defaults, storedRuntimeSettings ?? {}))
  }, [runtimes, runtimeKind, storedRuntimeSettings])

  return (
    <NewChatSurfaceView
      active={active}
      ready={owner.isReady}
      planMode={isPlanMode}
      dataTestId={dataTestId}
      layoutSlots={includeLayoutSlots
        ? (
          <NewChatLayoutSlots
            hasAside={hasWorkspace}
            hasBrowserPanel={hasLocalWorkspace}
            workspaceId={owner.selectedWorkspace?.id ?? null}
          />
        )
        : null}
      composer={<NewChatComposerCard owner={owner} active={active} testIdPrefix={testIdPrefix} />}
      quickActions={owner.promptInputCollapsed || owner.draft.length > 0
        ? null
        : (
            <NewChatQuickActionsView
              actions={QUICK_ACTIONS.map(action => ({
                id: action.labelKey,
                label: owner.t(action.labelKey),
                prompt: owner.t(action.promptKey),
              }))}
              onSelect={owner.handleQuickAction}
            />
          )}
      dialog={(
        <IssueIsolationStartDialog
          open={owner.isolationDialogOpen}
          groups={owner.issueIsolationGroups}
          onOpenChange={(open) => {
            if (!open) {
              owner.dismissIsolationDialog()
            }
          }}
          onConfirm={owner.handleIsolationDialogConfirm}
        />
      )}
    />
  )
}
