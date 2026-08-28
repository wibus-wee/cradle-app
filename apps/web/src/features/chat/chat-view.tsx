import type { RuntimeReviewTarget } from '@cradle/chat-runtime-contracts'
import {
  CloseLine as XIcon,
  PencilLine as PencilIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getPluginsReviews, patchPluginsByRouteSegmentEnabled } from '~/api-gen/sdk.gen'
import type { GetPluginsReviewsResponse } from '~/api-gen/types.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { nodeAccessDisablesInteraction, useNodeAccess } from '~/features/nodes/node-access'
import { SessionNodeBadge } from '~/features/nodes/session-node-badge'
import { IsolationBoundaryDialog } from '~/features/session/isolation-boundary-dialog'
import { IsolationMissingDialog } from '~/features/session/isolation-missing-dialog'
import {
  useSessionIsolationState,
} from '~/features/session/use-session-isolation'
import { useFeatureFlag } from '~/features/settings/use-app-preferences'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { useChatStore } from '~/store/chat'
import type { ComposerDraft } from '~/store/composer-draft'

import type { ChatRuntimeGoalUiSlotState } from './capabilities/chat-capabilities'
import { runtimeUiSlotStatesQueryKey } from './capabilities/chat-capabilities'
import { useQuickQuestion } from './capabilities/use-quick-question'
import type { ChatViewProps } from './chat-view-types'
import { describeChatExecutionError } from './commands/chat-execution-errors'
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
import type { ChatContextPart } from './context/chat-context-parts'
import {
  registerChatComposerContextIngressHandler,
  registerChatComposerFileIngressHandler,
  registerChatPromptIngressHandler,
} from './prompt-ingress'
import { clearCodexThreadGoal, setCodexThreadGoal } from './runtime/codex-app-server-bridge'
import { RuntimeSettingsControl } from './runtime/runtime-settings-control'
import { resolveRuntimeCatalogItem } from './runtime/runtime-settings-presenter'
import { useRuntimeSettings } from './runtime/use-runtime-settings'
import { readUserMessageDraft } from './session/read-user-message-draft'
import { useChatSession } from './session/use-chat-session'
import { useSessionAwaitSummary } from './session/use-session-await'
import type { ChatComposerSlashCommand } from './slash-commands/chat-slash-commands'
import {
  CRADLE_APPSHOT_SLASH_ACTION_ID,
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
} from './slash-commands/chat-slash-commands'
import { ThreadHandoffMenu } from './thread-handoff-menu'
import { ChatMessageListPane } from './transcript/containers/chat-message-list-pane'
import type { MessageBubbleEditAction } from './transcript/views/message-bubble-actions-view'
import type { RollbackDraftSignal } from './ui/chat-composer-section'
import { ChatComposerSection } from './ui/chat-composer-section'
import { ChatGoalEditorDialog } from './ui/chat-goal-editor-dialog'
import { PersonalPluginReviewCardView } from './ui/personal-plugin-review-card-view'
import { useChatScrollRuntime } from './ui/use-chat-scroll-runtime'

export type { ChatViewProps } from './chat-view-types'

const EMPTY_FILES: NonNullable<ChatViewProps['availableFiles']> = []
const EMPTY_CHAT_MESSAGES: UIMessage[] = []

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
  composerDecoration = null,
  placeholder,
  runtimeKind: _runtimeKind,
  workspaceId,
  workspacePath = null,
  nodeId = null,
  messageTextTransform,
  prepareSend,
  compactInset = false,
}: ChatViewProps) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  const { t: tNodes } = useTranslation('nodes')
  const { t: tSettings } = useTranslation('settings')
  const threadHandoffsEnabled = useFeatureFlag('threadHandoffs')
  const surfaceActive = useSurfaceActive()
  const chatActive = active && surfaceActive
  const {
    displayRows,
    messageCount,
    status,
    isStreaming,
    canStop,
    error,
    sendMessage,
    respondToToolApproval,
    stop,
    rollback,
    history,
    isReady,
    queueItems,
    cancelQueueItem,
    reorderQueueItems,
    updateQueueItem,
  } = useChatSession(sessionId, chatActive)
  const nodeAccess = useNodeAccess(nodeId)
  const nodeInteractionLocked = nodeId !== null && nodeAccessDisablesInteraction(nodeAccess)
  const guardedRespondToToolApproval = useCallback(
    (response: Parameters<typeof respondToToolApproval>[0]) => {
      if (nodeInteractionLocked) {
        return Promise.resolve()
      }
      return respondToToolApproval(response)
    },
    [nodeInteractionLocked, respondToToolApproval],
  )
  const sessionMetaQuery = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    enabled: chatActive && !!sessionId,
    staleTime: 5_000,
  })
  const pluginReviewsQuery = useQuery({
    queryKey: ['plugins', 'reviews', sessionId],
    enabled: chatActive && !!sessionId,
    queryFn: async () => {
      const { data, error } = await getPluginsReviews({ query: { chatSessionId: sessionId! } })
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as GetPluginsReviewsResponse
    },
  })
  const activatePluginReviewMutation = useMutation({
    mutationFn: async (review: GetPluginsReviewsResponse[number]) => {
      for (const plugin of review.source.plugins) {
        const { error } = await patchPluginsByRouteSegmentEnabled({
          path: { routeSegment: plugin.routeSegment },
          body: {
            enabled: true,
            grantedPermissions: plugin.declaredPermissions.map(permission => permission.localId),
          },
        })
        if (error) {
          throw new Error(String(error))
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins'] })
      toastManager.add({ type: 'success', title: tSettings('plugins.toast.enabled') })
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: tSettings('plugins.toast.toggleFailed'),
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })
  const isolationStateQuery = useSessionIsolationState(sessionId)
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId, chatActive)
  const [droppedPath, setDroppedPath] = useState<{ text: string, ts: number } | null>(null)
  const [editingGoal, setEditingGoal] = useState<ChatRuntimeGoalUiSlotState | null>(null)
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState('')
  const [goalActionBusy, setGoalActionBusy] = useState(false)
  const [reviewModeOpen, setReviewModeOpen] = useState(false)
  const [usageSlotSessionId, setUsageSlotSessionId] = useState<string | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [rollbackDraftSignal, setRollbackDraftSignal] = useState<RollbackDraftSignal | null>(null)
  const [clearComposerDraftSignal, setClearComposerDraftSignal] = useState<number | undefined>(
    undefined,
  )
  const [composerContextIngress, setComposerContextIngress] = useState<{
    parts: ChatContextPart[]
    key: number
  } | null>(null)
  const [pendingRollbackMessageId, setPendingRollbackMessageId] = useState<string | null>(null)
  const pendingRollbackMessageIdRef = useRef<string | null>(null)
  const runtimeSettings = useRuntimeSettings(sessionId, chatActive)
  const { runtimes } = useRuntimeCatalog()
  const runtimeCatalogItem = useMemo(
    () => resolveRuntimeCatalogItem(runtimes, runtimeSettings.runtimeKind ?? _runtimeKind),
    [runtimes, runtimeSettings.runtimeKind, _runtimeKind],
  )
  const composerRuntime = useChatComposerRuntime({
    active: chatActive,
    sessionId,
    isStreaming,
    canStop,
    isReady,
    workspaceId,
    nodeId,
    composerModel,
    sendOverridesRef,
    sendMessage,
    stop,
  })
  const scrollRuntime = useChatScrollRuntime({
    active: chatActive,
    sessionId,
    displayRows,
    status,
  })
  const loadEarlierMessages = useCallback(async () => {
    const viewport = scrollRuntime.viewportRef.current
    const previousScrollHeight = viewport?.scrollHeight ?? 0
    const previousScrollTop = viewport?.scrollTop ?? 0
    await history.loadEarlier()
    requestAnimationFrame(() => {
      const currentViewport = scrollRuntime.viewportRef.current
      if (!currentViewport) {
        return
      }
      currentViewport.scrollTop = previousScrollTop + currentViewport.scrollHeight - previousScrollHeight
    })
  }, [history, scrollRuntime.viewportRef])
  const appshotRuntime = useComposerAppshotCapture({
    active: chatActive,
    supportsAttachments: composerRuntime.supportsAttachments,
  })
  const historyMessages = useChatStore(state =>
    sessionId ? state.messagesMap.get(sessionId) ?? EMPTY_CHAT_MESSAGES : EMPTY_CHAT_MESSAGES)
  const promptHistory = useMemo<ComposerDraft[]>(() => {
    const drafts: ComposerDraft[] = []
    for (let index = historyMessages.length - 1; index >= 0 && drafts.length < 100; index--) {
      const draft = readUserMessageDraft(historyMessages[index])
      if (draft) {
        drafts.push(draft)
      }
    }
    return drafts
  }, [historyMessages])
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
    () => composerRuntime,
    [composerRuntime],
  )
  const preparedBaseComposerRuntime = useMemo<ChatComposerRuntime>(() => {
    return {
      ...navigableComposerRuntime,
      send: async (text, files, contextParts, options) => {
        const prepared = prepareSend
          ? await Promise.resolve(prepareSend({ text, files, contextParts, options }))
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
            ? (useChatStore.getState().messagesMap.get(sessionId) ?? [])
            : []
          const latestUserMessage
            = [...messages].reverse().find(message => message.role === 'user') ?? null
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
            const friendly
              = describeRollbackLastTurnError(error)
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
  // View-only Nodes: the composer and approval controls render disabled.
  const effectiveComposerRuntime = useMemo<ChatComposerRuntime>(
    () =>
      nodeInteractionLocked
        ? { ...preparedComposerRuntime, disabled: true }
        : preparedComposerRuntime,
    [nodeInteractionLocked, preparedComposerRuntime],
  )
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

  useEffect(() => {
    if (!sessionId) {
      return
    }
    return registerChatComposerContextIngressHandler(sessionId, (parts) => {
      setComposerContextIngress(current => ({
        parts,
        key: (current?.key ?? 0) + 1,
      }))
    })
  }, [sessionId])

  const handleEditPrevious = useCallback(async () => {
    if (!sessionId || rollbackBusy) {
      return
    }
    const messages = useChatStore.getState().messagesMap.get(sessionId) ?? []
    const lastUserMessage = editPreviousMessageId
      ? (messages.find(message => message.id === editPreviousMessageId) ?? null)
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
      draft,
    }))
  }, [editPreviousMessageId, rollbackBusy, sessionId, setPendingRollbackTarget, t])

  const editPreviousAction = useMemo<MessageBubbleEditAction | undefined>(() => {
    if (!rollback.supported || !editPreviousMessageId) {
      return undefined
    }
    return {
      busy: rollbackBusy,
      disabled: !rollback.canRollback || rollbackBusy,
      label: t('rollback.action.label'),
      title:
        pendingRollbackMessageId === editPreviousMessageId
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
      if (command.action.actionId === RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID) {
        try {
          await runtimeSettings.update({ serviceTier: 'fast' })
          return { insertText: '' }
        }
        catch (error) {
          toastManager.add({
            type: 'error',
            title: 'Fast mode update failed',
            description: error instanceof Error ? error.message : 'Unknown runtime settings error.',
          })
          return
        }
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
    [appshotRuntime, composerRuntime.supportsAttachments, runtimeSettings, sessionId],
  )

  const startCodexNativeReview = useCallback(
    async (target: RuntimeReviewTarget) => {
      const text = target.type === 'uncommittedChanges'
        ? 'Review uncommitted changes'
        : `Review changes against ${target.branch}`
      await composerSend(text, [], [], { reviewTarget: target })
    },
    [composerSend],
  )

  const reviewSlot = useMemo<ComposerReviewSlotActions>(
    () => ({
      open: reviewModeOpen,
      workspaceId,
      onDismiss: () => setReviewModeOpen(false),
      onStartReview: startCodexNativeReview,
    }),
    [reviewModeOpen, startCodexNativeReview, workspaceId],
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
      return <div className="flex min-w-0 items-center gap-1">{composerToolbarAddon}</div>
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
          runtime={runtimeCatalogItem}
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
    runtimeCatalogItem,
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
        <SessionNodeBadge nodeId={nodeId} />
        {threadHandoffsEnabled && sessionId && (
          <ThreadHandoffMenu
            sessionId={sessionId}
            providerTargetId={sessionMetaQuery.data?.providerTargetId ?? null}
            runtimeKind={sessionMetaQuery.data?.runtimeKind ?? null}
            workspaceId={workspaceId ?? null}
            disabled={status === 'streaming'}
          />
        )}
      </div>
    ),
    [
      nodeId,
      sessionId,
      sessionMetaQuery.data?.providerTargetId,
      sessionMetaQuery.data?.runtimeKind,
      status,
      threadHandoffsEnabled,
      workspaceId,
    ],
  )

  const layoutSlots = useMemo(() => ({ headerActions }), [headerActions])

  useRegisterLayoutSlots(sessionId ?? '', layoutSlots)

  const showIsolationBoundary
    = sessionMetaQuery.data?.isolationBoundaryRequired === true && status !== 'streaming'
  const showMissingIsolation = !!(
    isolationStateQuery.data?.worktreeId
    && isolationStateQuery.data.worktreeHealth
    && isolationStateQuery.data.worktreeHealth !== 'ok'
  )

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
        displayRows={displayRows}
        messageCount={messageCount}
        status={status}
        error={describeChatExecutionError(error) ?? error}
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
        onToolApprovalResponse={guardedRespondToToolApproval}
        editPreviousMessageId={editPreviousMessageId}
        editPreviousAction={editPreviousAction}
        messageTextTransform={messageTextTransform}
        hideMinimap={hideRuntimeToolbar}
        compactInset={compactInset}
        historyControl={history.hasEarlier
          ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={history.loadingEarlier}
                onClick={() => void loadEarlierMessages()}
              >
                {history.loadingEarlier ? t('history.loadingEarlier') : t('history.loadEarlier')}
              </Button>
            )
          : null}
        composerStack={(
          <>
            {nodeInteractionLocked && (
              <p
                className="px-3 py-1.5 text-[12px] text-muted-foreground"
                data-testid="session-view-only-notice"
              >
                {tNodes('session.viewOnly')}
              </p>
            )}
            {(pluginReviewsQuery.data ?? []).map(review => (
              <PersonalPluginReviewCardView
                key={review.sourceId}
                title={tSettings('plugins.chatReview.title')}
                description={tSettings('plugins.chatReview.description')}
                actionLabel={tSettings('plugins.chatReview.action')}
                permissionFallback={tSettings('plugins.trust.noPermissions')}
                activating={activatePluginReviewMutation.isPending
                  && activatePluginReviewMutation.variables?.sourceId === review.sourceId}
                onActivate={() => activatePluginReviewMutation.mutate(review)}
                plugins={review.source.plugins.map(plugin => ({
                  identity: plugin.identity,
                  displayName: plugin.displayName,
                  permissions: plugin.declaredPermissions.map(permission => ({
                    id: permission.id,
                    label: permission.label ?? permission.localId,
                  })),
                  layers: [
                    ...(plugin.hasServer ? [{ layer: 'server' as const, status: plugin.layers.server.status }] : []),
                    ...(plugin.hasWeb ? [{ layer: 'web' as const, status: plugin.layers.web.status }] : []),
                    ...(plugin.hasDesktop ? [{ layer: 'desktop' as const, status: plugin.layers.desktop.status }] : []),
                  ],
                }))}
              />
            ))}
            <ChatComposerSection
              sessionId={sessionId}
              workspacePath={workspacePath}
              runtimeKind={runtimeSettings.runtimeKind ?? _runtimeKind}
              awaitSummary={awaitSummary}
              queueItems={queueItems}
              onCancelQueueItem={queueItemId => void cancelQueueItem(queueItemId)}
              onReorderQueueItems={queueItemIds => void reorderQueueItems(queueItemIds)}
              onUpdateQueueItem={(queueItemId, body) => updateQueueItem(queueItemId, body)}
              onSlashCommandAction={handleSlashCommandAction}
              composerRuntime={effectiveComposerRuntime}
              appshotRuntime={appshotRuntime}
              placeholder={placeholder}
              availableFiles={availableFiles}
              searchFiles={searchFiles}
              searchPlugins={searchPlugins}
              searchSkills={searchSkills}
              toolbar={runtimeSettingsToolbar}
              runtimeSettings={{
                runtimeKind: runtimeSettings.runtimeKind ?? _runtimeKind,
                settings: runtimeSettings.settings,
                disabled:
                  !isReady
                  || !runtimeSettings.loaded
                  || runtimeSettings.loading,
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
              composerDecoration={composerDecoration}
              rollbackDraftSignal={rollbackDraftSignal}
              clearDraftSignal={clearComposerDraftSignal}
              suspendDraftPersistence={Boolean(pendingRollbackMessageId)}
              promptHistory={promptHistory}
              contextIngress={composerContextIngress}
            />
          </>
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
      {sessionId && (
        <IsolationBoundaryDialog
          sessionId={sessionId}
          workspaceId={workspaceId ?? null}
          open={showIsolationBoundary}
          onOpenChange={() => {
            void sessionMetaQuery.refetch()
          }}
        />
      )}
      {sessionId && (
        <IsolationMissingDialog
          sessionId={sessionId}
          workspaceId={workspaceId ?? null}
          worktreeId={isolationStateQuery.data?.worktreeId ?? null}
          open={showMissingIsolation}
        />
      )}
    </div>
  )
}
