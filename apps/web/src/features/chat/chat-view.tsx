import {
  CloseLine as XIcon,
  PencilLine as PencilIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getWorkspacesByWorkspaceIdGitMergeBase } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { useChatStore } from '~/store/chat'

import type { ChatRuntimeGoalUiSlotState } from './capabilities/chat-capabilities'
import { runtimeUiSlotStatesQueryKey } from './capabilities/chat-capabilities'
import { useQuickQuestion } from './capabilities/use-quick-question'
import type { ChatViewProps } from './chat-view-types'
import { describeRollbackLastTurnError } from './commands/rollback-last-turn-command'
import type {
  ComposerSlashCommandActionContext,
  ComposerSlashCommandActionResult,
  ComposerSlashCommandActionTools,
} from './composer/composer-action-context'
import type {
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer/composer-slot-states'
import type { ChatComposerRuntime } from './composer/use-chat-composer-runtime'
import { useChatComposerRuntime } from './composer/use-chat-composer-runtime'
import { useComposerAppshotCapture } from './composer/use-composer-appshot-capture'
import {
  registerChatComposerFileIngressHandler,
  registerChatPromptIngressHandler,
} from './prompt-ingress'
import type { MessageBubbleEditAction } from './rendering/message-bubble'
import { clearCodexThreadGoal, setCodexThreadGoal } from './runtime/codex-app-server-bridge'
import { RuntimeDiagnosticsPopover } from './runtime/runtime-diagnostics-popover'
import { RuntimeSettingsControl } from './runtime/runtime-settings-control'
import { useRuntimeSettings } from './runtime/use-runtime-settings'
import { readUserMessageDraft } from './session/read-user-message-draft'
import { useChatSession } from './session/use-chat-session'
import { useSessionAwaitSummary } from './session/use-session-await'
import type { ChatComposerSlashCommand } from './slash-commands/chat-slash-commands'
import {
  CRADLE_APPSHOT_SLASH_ACTION_ID,
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
} from './slash-commands/chat-slash-commands'
import type { RollbackDraftSignal } from './ui/chat-composer-section'
import { ChatComposerSection } from './ui/chat-composer-section'
import { ChatGoalEditorDialog } from './ui/chat-goal-editor-dialog'
import { ChatMessageListPane } from './ui/chat-transcript-pane'
import { useChatScrollRuntime } from './ui/use-chat-scroll-runtime'

export type { ChatViewProps } from './chat-view-types'

const EMPTY_FILES: NonNullable<ChatViewProps['availableFiles']> = []

export function ChatView({
  active = true,
  sessionId,
  availableFiles = EMPTY_FILES,
  searchFiles,
  searchPlugins,
  searchSkills,
  composerToolbar,
  composerToolbarAddon,
  hideRuntimeToolbar = false,
  composerContextBar,
  sendOverridesRef,
  composerModel,
  placeholder,
  runtimeKind: _runtimeKind,
  workspaceId,
  messageTextTransform,
  prepareSend,
  compactInset = false,
}: ChatViewProps) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  const surfaceActive = useSurfaceActive()
  const chatActive = active && surfaceActive
  const {
    messageIds,
    messageCount,
    status,
    isStreaming,
    error,
    sendMessage,
    respondToToolApproval,
    stop,
    rollback,
    isReady,
    queueItems,
    cancelQueueItem,
    reorderQueueItems,
    updateQueueItem,
  } = useChatSession(sessionId, chatActive)
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId, chatActive)
  const [droppedPath, setDroppedPath] = useState<{ text: string, ts: number } | null>(null)
  const [editingGoal, setEditingGoal] = useState<ChatRuntimeGoalUiSlotState | null>(null)
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState('')
  const [goalActionBusy, setGoalActionBusy] = useState(false)
  const [reviewModeOpen, setReviewModeOpen] = useState(false)
  const [usageSlotSessionId, setUsageSlotSessionId] = useState<string | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [rollbackDraftSignal, setRollbackDraftSignal] = useState<RollbackDraftSignal | null>(null)
  const [clearComposerDraftSignal, setClearComposerDraftSignal] = useState<number | undefined>(undefined)
  const [pendingRollbackMessageId, setPendingRollbackMessageId] = useState<string | null>(null)
  const pendingRollbackMessageIdRef = useRef<string | null>(null)
  const runtimeSettings = useRuntimeSettings(sessionId, chatActive)
  const composerRuntime = useChatComposerRuntime({
    active: chatActive,
    sessionId,
    isStreaming,
    isReady,
    workspaceId,
    composerModel,
    runtimeSettings: runtimeSettings.loaded ? runtimeSettings.settings : undefined,
    sendOverridesRef,
    sendMessage,
    stop,
  })
  const scrollRuntime = useChatScrollRuntime({ active: chatActive, sessionId, messageIds, status })
  const appshotRuntime = useComposerAppshotCapture({
    active: chatActive,
    supportsAttachments: composerRuntime.supportsAttachments,
  })
  const editPreviousMessageId = useChatStore((state) => {
    if (!sessionId || !rollback.supported) {
      return null
    }
    const messages = state.messagesMap.get(sessionId) ?? []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message?.role === 'user') {
        return message.id
      }
    }
    return null
  })
  const setPendingRollbackTarget = useCallback((messageId: string | null) => {
    pendingRollbackMessageIdRef.current = messageId
    setPendingRollbackMessageId(messageId)
  }, [])
  useEffect(() => {
    setPendingRollbackTarget(null)
    setRollbackDraftSignal(null)
  }, [sessionId, setPendingRollbackTarget])
  const quickQuestion = useQuickQuestion({
    sessionId: sessionId ?? '',
  })
  const hasQuickQuestionSlot = useMemo(() => {
    return composerRuntime.uiSlots.some(
      slot => slot.iconKey === 'quick-question' && slot.surfaces.includes('composerState'),
    )
  }, [composerRuntime.uiSlots])
  const quickQuestionSlot = useMemo<ComposerQuickQuestionSlotActions>(
    () => ({
      open: Boolean(sessionId) && hasQuickQuestionSlot && quickQuestion.open,
      question: quickQuestion.question,
      sessionId: sessionId ?? '',
      onDismiss: quickQuestion.closeQuickQuestion,
    }),
    [
      hasQuickQuestionSlot,
      quickQuestion.closeQuickQuestion,
      quickQuestion.open,
      quickQuestion.question,
      sessionId,
    ],
  )
  const navigableComposerRuntime = useMemo<ChatComposerRuntime>(
    () => ({
      ...composerRuntime,
    }),
    [composerRuntime],
  )
  const preparedBaseComposerRuntime = useMemo<ChatComposerRuntime>(() => {
    return {
      ...navigableComposerRuntime,
      send: (text, files, contextParts, options) => {
        const prepared = prepareSend
          ? prepareSend({ text, files, contextParts, options })
          : { text, files, contextParts, options }
        return navigableComposerRuntime.send(
          prepared.text,
          prepared.files ?? files,
          prepared.contextParts ?? contextParts,
          prepared.options ?? options,
        )
      },
    }
  }, [navigableComposerRuntime, prepareSend])
  const preparedComposerRuntime = useMemo<ChatComposerRuntime>(() => {
    return {
      ...preparedBaseComposerRuntime,
      send: async (text, files, contextParts, options) => {
        const rollbackMessageId = pendingRollbackMessageIdRef.current
        if (rollbackMessageId) {
          const messages = sessionId
            ? useChatStore.getState().messagesMap.get(sessionId) ?? []
            : []
          const latestUserMessage = [...messages].reverse().find(message => message.role === 'user') ?? null
          if (latestUserMessage?.id !== rollbackMessageId) {
            setPendingRollbackTarget(null)
            throw new Error(t('rollback.error.stale'))
          }

          setRollbackBusy(true)
          try {
            await rollback.rollback()
            setPendingRollbackTarget(null)
          }
          catch (error) {
            const friendly = describeRollbackLastTurnError(error)
              ?? (error instanceof Error ? error.message : t('rollback.error.fallback'))
            throw new Error(friendly)
          }
          finally {
            setRollbackBusy(false)
          }
        }
        return preparedBaseComposerRuntime.send(text, files, contextParts, options)
      },
    }
  }, [preparedBaseComposerRuntime, rollback, sessionId, setPendingRollbackTarget, t])
  const composerSend = preparedBaseComposerRuntime.send

  useEffect(() => {
    if (!sessionId) {
      return
    }
    return registerChatPromptIngressHandler(sessionId, ({ text, files, contextParts = [] }) => {
      composerSend(text, files, contextParts)
    })
  }, [composerSend, sessionId])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    return registerChatComposerFileIngressHandler(sessionId, appshotRuntime.appendFileParts)
  }, [appshotRuntime.appendFileParts, sessionId])

  const handleEditPrevious = useCallback(async () => {
    if (!sessionId || rollbackBusy) {
      return
    }
    const messages = useChatStore.getState().messagesMap.get(sessionId) ?? []
    const lastUserMessage = editPreviousMessageId
      ? messages.find(message => message.id === editPreviousMessageId) ?? null
      : null
    const draft = readUserMessageDraft(lastUserMessage)
    if (!draft) {
      toastManager.add({
        type: 'error',
        title: t('rollback.error.title'),
        description: t('rollback.error.noDraft'),
      })
      return
    }

    setPendingRollbackTarget(editPreviousMessageId)
    setRollbackDraftSignal(signal => ({
      key: (signal?.key ?? 0) + 1,
      draft: { text: draft.text, contextParts: draft.contextParts },
    }))
    if (draft.files.length > 0) {
      appshotRuntime.appendFileParts(draft.files)
    }
  }, [
    appshotRuntime,
    editPreviousMessageId,
    rollbackBusy,
    sessionId,
    setPendingRollbackTarget,
    t,
  ])

  const editPreviousAction = useMemo<MessageBubbleEditAction | undefined>(() => {
    if (!rollback.supported || !editPreviousMessageId) {
      return undefined
    }
    return {
      busy: rollbackBusy,
      disabled: !rollback.canRollback || rollbackBusy,
      label: t('rollback.action.label'),
      title: pendingRollbackMessageId === editPreviousMessageId
        ? t('rollback.action.pendingHint')
        : rollback.canRollback
        ? t('rollback.action.fileCaveat')
        : t('rollback.action.disabledHint'),
      onEdit: handleEditPrevious,
    }
  }, [
    editPreviousMessageId,
    handleEditPrevious,
    pendingRollbackMessageId,
    rollback.canRollback,
    rollback.supported,
    rollbackBusy,
    t,
  ])
  const cancelPendingRollbackEdit = useCallback(() => {
    setPendingRollbackTarget(null)
    setClearComposerDraftSignal(signal => (signal ?? 0) + 1)
  }, [setPendingRollbackTarget])
  const effectiveComposerContextBar = useMemo(() => {
    if (!pendingRollbackMessageId) {
      return composerContextBar
    }

    const editModeChip = (
      <div
        className="inline-flex min-w-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-warning-foreground ring-1 ring-inset ring-warning/25"
        data-testid="chat-edit-last-message-indicator"
      >
        <PencilIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('rollback.editor.cancel')}
          title={t('rollback.editor.cancel')}
          onClick={cancelPendingRollbackEdit}
          className="relative size-4 rounded-full p-0 text-warning-foreground/70 hover:bg-warning/15 hover:text-warning-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-warning/40 before:absolute before:-inset-2"
        >
          <XIcon className="size-3" aria-hidden="true" />
        </Button>
      </div>
    )

    if (!composerContextBar) {
      return editModeChip
    }

    return (
      <div className="flex min-w-0 items-center gap-1.5">
        {editModeChip}
        {composerContextBar}
      </div>
    )
  }, [cancelPendingRollbackEdit, composerContextBar, pendingRollbackMessageId, t])

  const refreshGoalRuntimeState = useCallback(() => {
    if (!sessionId) {
      return
    }
    void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
    void queryClient.invalidateQueries({ queryKey: ['chat', 'runtime-session-status', sessionId] })
  }, [queryClient, sessionId])

  const invokeCodexGoalAction = useCallback(
    async (
      action: 'set' | 'clear',
      params: {
        threadId: string
        objective?: string
        status?: string
      },
      failureTitle: string,
    ) => {
      if (!sessionId) {
        return
      }

      setGoalActionBusy(true)
      try {
        if (action === 'set') {
          await setCodexThreadGoal({ sessionId, ...params })
        }
        else {
          await clearCodexThreadGoal({ sessionId, threadId: params.threadId })
        }
        refreshGoalRuntimeState()
        setGoalActionBusy(false)
        return true
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: failureTitle,
          description: error instanceof Error ? error.message : 'Unknown goal action error.',
        })
        setGoalActionBusy(false)
        return false
      }
    },
    [refreshGoalRuntimeState, sessionId],
  )

  const goalActions = useMemo(
    () => ({
      busy: goalActionBusy,
      onEdit: (state: ChatRuntimeGoalUiSlotState) => {
        setEditingGoal(state)
        setGoalObjectiveDraft(state.objective)
      },
      onPause: (state: ChatRuntimeGoalUiSlotState) => {
        void invokeCodexGoalAction(
          'set',
          {
            threadId: state.threadId,
            status: 'paused',
          },
          'Goal pause failed',
        )
      },
      onResume: (state: ChatRuntimeGoalUiSlotState) => {
        void invokeCodexGoalAction(
          'set',
          {
            threadId: state.threadId,
            status: 'active',
          },
          'Goal resume failed',
        )
      },
      onClear: (state: ChatRuntimeGoalUiSlotState) => {
        void invokeCodexGoalAction(
          'clear',
          {
            threadId: state.threadId,
          },
          'Goal clear failed',
        )
      },
    }),
    [goalActionBusy, invokeCodexGoalAction],
  )

  const closeGoalEditor = useCallback(() => {
    if (goalActionBusy) {
      return
    }
    setEditingGoal(null)
    setGoalObjectiveDraft('')
  }, [goalActionBusy])

  const submitGoalEditor = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!editingGoal) {
        return
      }

      const objective = goalObjectiveDraft.trim()
      if (!objective) {
        toastManager.add({
          type: 'error',
          title: 'Goal update failed',
          description: 'Goal objective cannot be empty.',
        })
        return
      }

      if (objective === editingGoal.objective) {
        closeGoalEditor()
        return
      }

      void invokeCodexGoalAction(
        'set',
        {
          threadId: editingGoal.threadId,
          objective,
        },
        'Goal update failed',
      ).then((updated) => {
        if (updated) {
          closeGoalEditor()
        }
      })
    },
    [closeGoalEditor, editingGoal, goalObjectiveDraft, invokeCodexGoalAction],
  )

  const handleSlashCommandAction = useCallback(
    async (
      command: ChatComposerSlashCommand,
      context: ComposerSlashCommandActionContext,
      tools?: ComposerSlashCommandActionTools,
    ): Promise<void | ComposerSlashCommandActionResult> => {
      if (command.action.kind !== 'uiAction') {
        return
      }
      if (command.action.actionId === RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID) {
        setReviewModeOpen(true)
        return { insertText: '' }
      }
      if (command.action.actionId === RUNTIME_USAGE_COMMAND_ACTION_ID) {
        setUsageSlotSessionId(sessionId)
        return { insertText: '' }
      }
      if (command.action.actionId !== CRADLE_APPSHOT_SLASH_ACTION_ID) {
        return
      }
      if (!appshotRuntime.hasNativeCapture) {
        toastManager.add({
          type: 'error',
          title: 'Appshot is unavailable',
          description: 'Appshot capture requires the Electron desktop app.',
        })
        return
      }
      if (!composerRuntime.supportsAttachments) {
        toastManager.add({
          type: 'error',
          title: 'Appshot attachment is unavailable',
          description: 'The selected model does not accept image attachments.',
        })
        return
      }

      try {
        await appshotRuntime.capture({ tools })
        return { insertText: '' }
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Appshot capture failed',
          description: error instanceof Error ? error.message : 'Unknown Appshot capture error.',
        })
      }
    },
    [appshotRuntime, composerRuntime.supportsAttachments, sessionId],
  )

  const submitCodexReviewPrompt = useCallback(
    (prompt: string) => {
      void composerSend(prompt, [], [])
    },
    [composerSend],
  )

  const resolveCodexReviewMergeBase = useCallback(
    async (baseBranch: string, repositoryPath?: string | null) => {
      if (!workspaceId) {
        return null
      }
      const result = await getWorkspacesByWorkspaceIdGitMergeBase({
        path: { workspaceId },
        query: {
          baseBranch,
          ...(repositoryPath ? { repo: repositoryPath } : {}),
        },
      })
      if (result.error || !result.data) {
        throw new Error(`Failed to resolve merge base (${result.response?.status ?? 'unknown'}).`)
      }
      return result.data.mergeBaseSha
    },
    [workspaceId],
  )

  const reviewSlot = useMemo<ComposerReviewSlotActions>(
    () => ({
      open: reviewModeOpen,
      workspaceId,
      onDismiss: () => setReviewModeOpen(false),
      onSubmitPrompt: submitCodexReviewPrompt,
      resolveMergeBase: resolveCodexReviewMergeBase,
    }),
    [resolveCodexReviewMergeBase, reviewModeOpen, submitCodexReviewPrompt, workspaceId],
  )

  const usageSlot = useMemo<ComposerUsageSlotActions>(
    () => ({
      open: Boolean(sessionId) && usageSlotSessionId === sessionId,
      onDismiss: () => setUsageSlotSessionId(null),
    }),
    [sessionId, usageSlotSessionId],
  )

  const updateRuntimeSettings = useCallback(
    (patch: Parameters<typeof runtimeSettings.update>[0]) => {
      void runtimeSettings.update(patch).catch((error) => {
        toastManager.add({
          type: 'error',
          title: 'Runtime settings update failed',
          description: error instanceof Error ? error.message : 'Unknown runtime settings error.',
        })
      })
    },
    [runtimeSettings],
  )

  const runtimeSettingsToolbar = useMemo(() => {
    if (hideRuntimeToolbar) {
      // Ambient hosts (e.g. Jarvis) surface only their own context toggle via
      // the context bar; the runtime gear and provider/model/thinking toolbar
      // are noise on a per-message basis. Keep only the host-supplied addon
      // (which renders nothing when there are no explicit attachments).
      return (
        <div className="flex min-w-0 items-center gap-1">
          {composerToolbarAddon}
        </div>
      )
    }
    if (!sessionId) {
      return (
        <div className="flex min-w-0 items-center gap-1">
          {composerToolbar}
          {composerToolbarAddon}
        </div>
      )
    }
    return (
      <div className="flex min-w-0 items-center gap-1">
        <RuntimeSettingsControl
          settings={runtimeSettings.settings}
          applied={runtimeSettings.applied}
          disabled={!isReady || !runtimeSettings.loaded || runtimeSettings.loading}
          saving={runtimeSettings.saving}
          onChange={updateRuntimeSettings}
        />
        {composerToolbar}
        {composerToolbarAddon}
      </div>
    )
  }, [
    composerToolbarAddon,
    composerToolbar,
    hideRuntimeToolbar,
    isReady,
    runtimeSettings.applied,
    runtimeSettings.loaded,
    runtimeSettings.loading,
    runtimeSettings.saving,
    runtimeSettings.settings,
    sessionId,
    updateRuntimeSettings,
  ])

  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-0.5">
        {import.meta.env.DEV && (
          <RuntimeDiagnosticsPopover
            slots={composerRuntime.uiSlots}
            states={composerRuntime.slotStates}
          />
        )}
      </div>
    ),
    [composerRuntime.slotStates, composerRuntime.uiSlots],
  )

  const layoutSlots = useMemo(() => ({ headerActions }), [headerActions])

  useRegisterLayoutSlots(sessionId ?? '', layoutSlots)

  return (
    <div
      className="relative flex h-full flex-col"
      data-testid="chat-view"
      data-chat-ready={isReady ? 'true' : 'false'}
      data-chat-active={chatActive ? 'true' : 'false'}
      data-chat-session-id={sessionId ?? ''}
      data-chat-status={status}
      suppressHydrationWarning
      onDrop={(e) => {
        e.preventDefault()
        const path = readWorkspaceFileDragText(e.dataTransfer)
        if (path) {
          setDroppedPath({ text: path, ts: Date.now() })
        }
      }}
      onDragOver={e => e.preventDefault()}
    >
      <ChatMessageListPane
        sessionId={sessionId}
        messageIds={messageIds}
        messageCount={messageCount}
        status={status}
        error={error}
        isReady={isReady}
        scrollContainerRef={scrollRuntime.scrollContainerRef}
        viewportRef={scrollRuntime.viewportRef}
        composerOverlayRef={scrollRuntime.composerOverlayRef}
        virtualizerRef={scrollRuntime.virtualizerRef}
        minimapRef={scrollRuntime.minimapRef}
        keepMountedIndices={scrollRuntime.keepMountedIndices}
        scrollMetrics={scrollRuntime.metrics}
        onVirtualScroll={scrollRuntime.handleVirtualScroll}
        onScrollToMessageIndex={scrollRuntime.scrollToMessageIndex}
        onScrollToOffset={scrollRuntime.scrollToOffset}
        onToolApprovalResponse={respondToToolApproval}
        editPreviousMessageId={editPreviousMessageId}
        editPreviousAction={editPreviousAction}
        messageTextTransform={messageTextTransform}
        hideMinimap={hideRuntimeToolbar}
        compactInset={compactInset}
        composerStack={(
          <ChatComposerSection
            sessionId={sessionId}
            awaitSummary={awaitSummary}
            queueItems={queueItems}
            onCancelQueueItem={queueItemId => void cancelQueueItem(queueItemId)}
            onReorderQueueItems={queueItemIds => void reorderQueueItems(queueItemIds)}
            onUpdateQueueItem={(queueItemId, body) => updateQueueItem(queueItemId, body)}
            onSlashCommandAction={handleSlashCommandAction}
            composerRuntime={preparedComposerRuntime}
            appshotRuntime={appshotRuntime}
            placeholder={placeholder}
            availableFiles={availableFiles}
            searchFiles={searchFiles}
            searchPlugins={searchPlugins}
            searchSkills={searchSkills}
            toolbar={runtimeSettingsToolbar}
            runtimeSettings={{
              settings: runtimeSettings.settings,
              disabled: !isReady || !runtimeSettings.loaded || runtimeSettings.loading,
              onChange: updateRuntimeSettings,
            }}
            contextBar={effectiveComposerContextBar}
            droppedPath={droppedPath}
            goalActions={goalActions}
            quickQuestionSlot={quickQuestionSlot}
            reviewSlot={reviewSlot}
            usageSlot={usageSlot}
            onQuickQuestion={
              sessionId && hasQuickQuestionSlot ? quickQuestion.openQuickQuestion : undefined
            }
            onComposerFocusChange={scrollRuntime.handleComposerFocusChange}
            rollbackDraftSignal={rollbackDraftSignal}
            clearDraftSignal={clearComposerDraftSignal}
            suspendDraftPersistence={Boolean(pendingRollbackMessageId)}
          />
        )}
      />

      <ChatGoalEditorDialog
        open={editingGoal !== null}
        objectiveDraft={goalObjectiveDraft}
        busy={goalActionBusy}
        onObjectiveDraftChange={setGoalObjectiveDraft}
        onClose={closeGoalEditor}
        onSubmit={submitGoalEditor}
      />
    </div>
  )
}
