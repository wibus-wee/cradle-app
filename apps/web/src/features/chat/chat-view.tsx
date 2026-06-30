import {
  AlertLine as AlertCircleIcon,
  CloseLine as XIcon,
  ExternalLinkLine as ExternalLinkIcon,
  PencilLine as PencilIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer } from 'virtua'

import { postChatSessionsBySessionIdCodexAppServerInvoke } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toast'
import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'
import type { LiveAwaitStatus, UnsupportedLiveAwaitStatus } from '~/features/session-await/use-live-await-status'
import { describeLiveAwaitStatus, useLiveAwaitStatus } from '~/features/session-await/use-live-await-status'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { chatSurfaceId } from '~/navigation/surface-identity'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'

import type { PlanRefineEditorSaveDetail } from '../browser/plan-refine-editor'
import { PLAN_REFINE_EDITOR_SAVE_EVENT } from '../browser/plan-refine-editor'
import type { MentionItem } from '.'
import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimePlanUiSlotState,
} from './capabilities/chat-capabilities'
import { runtimeUiSlotStatesQueryKey } from './capabilities/chat-capabilities'
import { useQuickQuestion } from './capabilities/use-quick-question'
import type { ChatQueueEnqueueBody, ChatQueueItem } from './commands/chat-response-command'
import { describeRollbackLastTurnError } from './commands/rollback-last-turn-command'
import type { ComposerRuntimeSettingsController } from './composer/composer'
import { Composer } from './composer/composer'
import type {
  ComposerSlashCommandActionContext,
  ComposerSlashCommandActionResult,
  ComposerSlashCommandActionTools,
} from './composer/composer-action-context'
import type {
  ComposerPlanSlotActions,
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer/composer-slot-states'
import { ComposerSlotStates } from './composer/composer-slot-states'
import type { ChatComposerRuntime } from './composer/use-chat-composer-runtime'
import { useChatComposerRuntime } from './composer/use-chat-composer-runtime'
import type { ComposerAppshotRuntime } from './composer/use-composer-appshot-capture'
import { useComposerAppshotCapture } from './composer/use-composer-appshot-capture'
import type { PluginMentionItem } from './mentions/mention-panel'
import type { SkillMentionItem } from './mentions/skill-mention-panel'
import {
  registerChatComposerFileIngressHandler,
  registerChatPromptIngressHandler,
} from './prompt-ingress'
import type { MessageBubbleEditAction, MessageTextTransform } from './rendering/message-bubble'
import { MessageBubbleById } from './rendering/message-bubble'
import { RuntimeDiagnosticsPopover } from './runtime/runtime-diagnostics-popover'
import { RuntimeSettingsControl } from './runtime/runtime-settings-control'
import { useRuntimeSettings } from './runtime/use-runtime-settings'
import { readUserMessageDraft } from './session/read-user-message-draft'
import type { SendMessageOptions, SendMessageResult } from './session/use-chat-session'
import { useChatSession } from './session/use-chat-session'
import { useSessionAwaitSummary } from './session/use-session-await'
import type { ChatComposerSlashCommand } from './slash-commands/chat-slash-commands'
import {
  CODEX_REVIEW_SLASH_ACTION_ID,
  CODEX_USAGE_SLASH_ACTION_ID,
  CRADLE_APPSHOT_SLASH_ACTION_ID,
} from './slash-commands/chat-slash-commands'
import { ChatMinimap } from './ui/chat-minimap'
import { ChatQueueList } from './ui/chat-queue-list'
import type { ChatScrollRuntime } from './ui/use-chat-scroll-runtime'
import { useChatScrollRuntime } from './ui/use-chat-scroll-runtime'

const CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:'
const CODEX_PLAN_MAKE_GOAL_PROMPT_PREFIX = 'PLEASE MAKE A GOAL TO IMPLEMENT THIS PLAN:'
const CODEX_PLAN_REFINE_PROMPT_PREFIX = 'PLEASE REFINE THIS PLAN:'

type ComposerReplaceDraft = {
  text: string
  contextParts: ChatQueueItem['contextParts']
}

type RollbackDraftSignal = {
  key: number
  draft: ComposerReplaceDraft
}

function hashPlanRefineRequestContent(content: string): string {
  let hash = 0
  for (let index = 0; index < content.length; index++) {
    hash = (Math.imul(31, hash) + content.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function readPlanSlotContent(state: ChatRuntimePlanUiSlotState): string {
  return (
    state.content?.trim()
    || state.explanation?.trim()
    || state.steps
      .map(step => step.step)
      .join('\n')
      .trim()
  )
}

export interface ChatViewProps {
  active?: boolean
  sessionId: string | null
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
  /** Lazy workspace file search for @ mention */
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  /** Lazy plugin search for @ mention */
  searchPlugins?: (query: string, signal?: AbortSignal) => Promise<PluginMentionItem[]>
  /** Lazy skill search for $ mention */
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  /** Custom toolbar rendered in the composer left slot */
  composerToolbar?: React.ReactNode
  /** Additional toolbar content rendered after the default composer toolbar */
  composerToolbarAddon?: React.ReactNode
  /**
   * Hide the runtime settings gear and the default composer toolbar
   * (runtime/provider/model/thinking controls). Used by ambient hosts like
   * Jarvis that surface only a Context toggle — runtime/model are chosen once
   * in preferences, not per message. Only `composerToolbarAddon` remains.
   */
  hideRuntimeToolbar?: boolean
  /** Ref to read per-message overrides (modelId, thinkingEffort) before sending */
  sendOverridesRef?: React.MutableRefObject<{
    providerTargetId?: string
    modelId?: string | null
    thinkingEffort?: SendMessageOptions['thinkingEffort']
  }>
  /** Currently selected composer model, including provider-switched chat sessions before the first run persists. */
  composerModel?: ModelDescriptor | null
  /** Custom context bar rendered before the send button */
  composerContextBar?: React.ReactNode
  /**
   * Strip the transcript + composer horizontal inset for ambient hosts that
   * render ChatView inside a narrow floating panel (e.g. Jarvis). Drops the
   * `max-w-[90%]` reading-width constraint and the `pr-12` minimap gutter
   * (the minimap is already hidden via `hideRuntimeToolbar` in these hosts)
   * and reduces side padding to `px-1` so the scarce horizontal space isn't
   * wasted. The main chat view is unaffected (defaults to false).
   */
  compactInset?: boolean
  /** Placeholder text for composer */
  placeholder?: string
  runtimeKind?: RuntimeKind
  workspaceId?: string | null
  messageTextTransform?: MessageTextTransform
  prepareSend?: (input: {
    text: Parameters<ChatComposerRuntime['send']>[0]
    files: Parameters<ChatComposerRuntime['send']>[1]
    contextParts: Parameters<ChatComposerRuntime['send']>[2]
    options?: Parameters<ChatComposerRuntime['send']>[3]
  }) => {
    text: Parameters<ChatComposerRuntime['send']>[0]
    files?: Parameters<ChatComposerRuntime['send']>[1]
    contextParts?: Parameters<ChatComposerRuntime['send']>[2]
    options?: Parameters<ChatComposerRuntime['send']>[3]
  }
}

const EMPTY_FILES: MentionItem[] = []

function ChatTranscriptContent({
  sessionId,
  messageIds,
  messageCount,
  status,
  error,
  isReady,
  viewportRef,
  virtualizerRef,
  keepMountedIndices,
  onVirtualScroll,
  onToolApprovalResponse,
  editPreviousMessageId,
  editPreviousAction,
  messageTextTransform,
  compactInset,
}: {
  sessionId: string | null
  messageIds: ReturnType<typeof useChatSession>['messageIds']
  messageCount: ReturnType<typeof useChatSession>['messageCount']
  status: ReturnType<typeof useChatSession>['status']
  error: ReturnType<typeof useChatSession>['error']
  isReady: boolean
  viewportRef: ChatScrollRuntime['viewportRef']
  virtualizerRef: ChatScrollRuntime['virtualizerRef']
  keepMountedIndices: ChatScrollRuntime['keepMountedIndices']
  onVirtualScroll: ChatScrollRuntime['handleVirtualScroll']
  onToolApprovalResponse: ReturnType<typeof useChatSession>['respondToToolApproval']
  editPreviousMessageId?: string | null
  editPreviousAction?: MessageBubbleEditAction
  messageTextTransform?: MessageTextTransform
  compactInset?: boolean
}) {
  const { t } = useTranslation('chat')

  function renderMessage(messageId: string) {
    return (
      <MessageBubbleById
        key={messageId}
        sessionId={sessionId}
        messageId={messageId}
        onToolApprovalResponse={onToolApprovalResponse}
        editAction={messageId === editPreviousMessageId ? editPreviousAction : undefined}
        textTransform={messageTextTransform}
      />
    )
  }

  return (
    <div
      ref={viewportRef}
      className="h-full overflow-x-hidden overflow-y-auto outline-none [scrollbar-gutter:stable]"
    >
      <div
        className={cn(
          'mx-auto flex min-h-full flex-col pt-4',
          compactInset ? 'px-4' : 'max-w-[90%] px-4 pr-12',
        )}
        style={{ paddingBottom: 'var(--chat-composer-inset, 0px)' }}
      >
        <div className="flex-1">
          {messageCount === 0 && isReady && (
            <div className="flex h-full items-center justify-center py-32">
              <p className="select-none text-sm text-muted-foreground">
                {t('empty.startConversation')}
              </p>
            </div>
          )}

          <Virtualizer
            ref={virtualizerRef}
            data={messageIds}
            scrollRef={viewportRef}
            startMargin={24}
            keepMounted={keepMountedIndices}
            onScroll={onVirtualScroll}
          >
            {renderMessage}
          </Virtualizer>

          {status === 'error' && (
            <m.div
              data-testid="chat-error-banner"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-start gap-2 pl-1 pt-4"
            >
              <AlertCircleIcon
                className="size-3.5 shrink-0 !text-destructive/70"
                aria-hidden="true"
              />
              <span className="min-w-0 break-all text-xs text-destructive/70">
                {error ?? t('error.loadMessages')}
              </span>
            </m.div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatMessageListPane({
  sessionId,
  messageIds,
  messageCount,
  status,
  error,
  isReady,
  scrollContainerRef,
  viewportRef,
  composerOverlayRef,
  virtualizerRef,
  minimapRef,
  keepMountedIndices,
  scrollMetrics,
  onVirtualScroll,
  onScrollToMessageIndex,
  onScrollToOffset,
  onToolApprovalResponse,
  editPreviousMessageId,
  editPreviousAction,
  composerStack,
  hideMinimap,
  messageTextTransform,
  compactInset,
}: {
  sessionId: string | null
  messageIds: ReturnType<typeof useChatSession>['messageIds']
  messageCount: ReturnType<typeof useChatSession>['messageCount']
  status: ReturnType<typeof useChatSession>['status']
  error: ReturnType<typeof useChatSession>['error']
  isReady: boolean
  scrollContainerRef: ChatScrollRuntime['scrollContainerRef']
  viewportRef: ChatScrollRuntime['viewportRef']
  composerOverlayRef: ChatScrollRuntime['composerOverlayRef']
  virtualizerRef: ChatScrollRuntime['virtualizerRef']
  minimapRef: ChatScrollRuntime['minimapRef']
  keepMountedIndices: ChatScrollRuntime['keepMountedIndices']
  scrollMetrics: ChatScrollRuntime['metrics']
  onVirtualScroll: ChatScrollRuntime['handleVirtualScroll']
  onScrollToMessageIndex: ChatScrollRuntime['scrollToMessageIndex']
  onScrollToOffset: ChatScrollRuntime['scrollToOffset']
  onToolApprovalResponse: ReturnType<typeof useChatSession>['respondToToolApproval']
  editPreviousMessageId?: string | null
  editPreviousAction?: MessageBubbleEditAction
  composerStack: React.ReactNode
  hideMinimap?: boolean
  messageTextTransform?: MessageTextTransform
  compactInset?: boolean
}) {
  return (
    <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <ChatTranscriptContent
        sessionId={sessionId}
        messageIds={messageIds}
        messageCount={messageCount}
        status={status}
        error={error}
        isReady={isReady}
        viewportRef={viewportRef}
        virtualizerRef={virtualizerRef}
        keepMountedIndices={keepMountedIndices}
        onVirtualScroll={onVirtualScroll}
        onToolApprovalResponse={onToolApprovalResponse}
        editPreviousMessageId={editPreviousMessageId}
        editPreviousAction={editPreviousAction}
        messageTextTransform={messageTextTransform}
        compactInset={compactInset}
      />

      <div ref={composerOverlayRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div
          className={cn(
            'mx-auto pt-4 pb-3',
            compactInset ? 'px-4' : 'max-w-[90%] px-4 pr-12',
          )}
        >
          {composerStack}
        </div>
      </div>

      {hideMinimap
        ? null
        : (
            <ChatMinimap
              ref={minimapRef}
              sessionId={sessionId}
              messageIds={messageIds}
              scrollHeight={scrollMetrics.scrollHeight}
              viewportHeight={scrollMetrics.viewportHeight}
              onScrollToIndex={onScrollToMessageIndex}
              onScrollTo={onScrollToOffset}
            />
          )}
    </div>
  )
}

function ChatAwaitBanner({
  awaitSummary,
}: {
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
}) {
  const { t } = useTranslation('chat')
  const primaryAwaitId = typeof awaitSummary?.primaryAwaitId === 'string' ? awaitSummary.primaryAwaitId : null
  const primarySource = typeof awaitSummary?.primarySource === 'string' ? awaitSummary.primarySource : null
  const supportsLiveStatus = primarySource === 'github-ci' || primarySource === 'github-review'
  const { data: rawLiveStatus } = useLiveAwaitStatus(
    awaitSummary?.awaiting && supportsLiveStatus ? primaryAwaitId : null,
    awaitSummary?.awaiting ?? false,
  )

  if (!awaitSummary?.awaiting) {
    return null
  }

  const liveStatus = rawLiveStatus as LiveAwaitStatus | UnsupportedLiveAwaitStatus | undefined
  const liveText = describeLiveAwaitStatus(liveStatus)
  const sourceLabel = primarySource === 'github-ci'
    ? 'GitHub checks'
    : primarySource === 'github-review'
      ? 'GitHub review'
      : null
  const bannerText = liveText && sourceLabel
    ? `${sourceLabel}: ${liveText}`
    : (awaitSummary.reason as string)
      ?? t('await.waitingFor', {
        source: primarySource ?? t('await.source.event'),
      })

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/50 backdrop-blur-3xl px-3 py-2 text-xs text-muted-foreground">
      <Spinner className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {bannerText}
      </span>
      <button
        type="button"
        onClick={() => useLayoutStore.getState().openAsideTab('await')}
        className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3" />
        <span>{t('await.action.view')}</span>
      </button>
    </div>
  )
}

function ChatComposerSection({
  sessionId,
  awaitSummary,
  queueItems,
  onCancelQueueItem,
  onReorderQueueItems,
  onUpdateQueueItem,
  onSlashCommandAction,
  composerRuntime,
  appshotRuntime,
  placeholder,
  availableFiles,
  searchFiles,
  searchPlugins,
  searchSkills,
  toolbar,
  runtimeSettings,
  contextBar,
  droppedPath,
  goalActions,
  planActions,
  quickQuestionSlot,
  reviewSlot,
  usageSlot,
  onQuickQuestion,
  onComposerFocusChange,
  rollbackDraftSignal,
  clearDraftSignal,
  suspendDraftPersistence,
}: {
  sessionId: string | null
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
  queueItems: ChatQueueItem[]
  onCancelQueueItem: (queueItemId: string) => void
  onReorderQueueItems: (queueItemIds: string[]) => void
  onUpdateQueueItem: (queueItemId: string, body: ChatQueueEnqueueBody) => Promise<void>
  onSlashCommandAction?: (
    command: ChatComposerSlashCommand,
    context: ComposerSlashCommandActionContext,
    tools?: ComposerSlashCommandActionTools,
  ) => Promise<void | ComposerSlashCommandActionResult> | void | ComposerSlashCommandActionResult
  composerRuntime: ChatComposerRuntime
  appshotRuntime: ComposerAppshotRuntime
  placeholder?: string
  availableFiles: MentionItem[]
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  searchPlugins?: (query: string, signal?: AbortSignal) => Promise<PluginMentionItem[]>
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  toolbar?: React.ReactNode
  runtimeSettings?: ComposerRuntimeSettingsController
  contextBar?: React.ReactNode
  droppedPath: { text: string, ts: number } | null
  goalActions: {
    busy: boolean
    onEdit: (state: ChatRuntimeGoalUiSlotState) => void
    onPause: (state: ChatRuntimeGoalUiSlotState) => void
    onResume: (state: ChatRuntimeGoalUiSlotState) => void
    onClear: (state: ChatRuntimeGoalUiSlotState) => void
  }
  planActions?: ComposerPlanSlotActions
  quickQuestionSlot?: ComposerQuickQuestionSlotActions
  reviewSlot: ComposerReviewSlotActions
  usageSlot: ComposerUsageSlotActions
  onQuickQuestion?: (question: string) => void
  onComposerFocusChange?: (focused: boolean) => void
  rollbackDraftSignal?: RollbackDraftSignal | null
  clearDraftSignal?: number
  suspendDraftPersistence?: boolean
}) {
  const activeBrowserPanelOwnerId = useLayoutStore(s => s.activeBrowserPanelOwnerId)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)
  const openPlanRefineTab = useBrowserPanelStore(s => s.openPlanRefineTab)
  const [composerReplaceText, setComposerReplaceText] = useState<string | undefined>(undefined)
  const [composerReplaceTextKey, setComposerReplaceTextKey] = useState(0)
  const [composerReplaceDraft, setComposerReplaceDraft] = useState<
    { text: string, contextParts: ChatQueueItem['contextParts'] } | undefined
  >(undefined)
  const [composerReplaceDraftKey, setComposerReplaceDraftKey] = useState(0)
  const [dismissPlanSignal, setDismissPlanSignal] = useState(0)
  const [composerHasDraft, setComposerHasDraft] = useState(false)
  const [activePlanRefineTabId, setActivePlanRefineTabId] = useState<string | null>(null)
  // Queue-item edit-in-place: when set, the next submit PATCHes this queue item
  // instead of enqueueing a new follow-up.
  const editingQueueItemIdRef = useRef<string | null>(null)
  const [editingQueueItemId, setEditingQueueItemId] = useState<string | null>(null)
  const planState
    = composerRuntime.slotStates.find(
      (state): state is ChatRuntimePlanUiSlotState => state.kind === 'plan',
    ) ?? null
  const planRefineEditorOpen = useBrowserPanelStore(
    state =>
      activePlanRefineTabId !== null
      && state.owners[activeBrowserPanelOwnerId]?.tabs.some(
        tab => tab.id === activePlanRefineTabId,
      ) === true,
  )

  const submitComposerMessage = useCallback(
    (...args: Parameters<ChatComposerRuntime['send']>): SendMessageResult | Promise<SendMessageResult> => {
      const editingId = editingQueueItemIdRef.current
      if (editingId) {
        const [text, files, contextParts] = args
        return (async () => {
          try {
            await onUpdateQueueItem(editingId, {
              text,
              files,
              contextParts,
              runtimeSettings: runtimeSettings?.settings,
            })
          }
          catch (error) {
            const code = (error as { code?: string } | null)?.code
            const status = (error as { status?: number } | null)?.status
            if (code === 'chat_queue_item_not_pending' || status === 409) {
              toastManager.add({
                type: 'error',
                title: 'Queue item no longer editable',
                description: 'This queue item was already claimed or cancelled.',
              })
            }
            else {
              throw error
            }
          }
          finally {
            editingQueueItemIdRef.current = null
            setEditingQueueItemId(null)
          }
          if (planState) {
            setDismissPlanSignal(signal => signal + 1)
          }
          return undefined
        })()
      }
      const result = composerRuntime.send(...args)
      if (result instanceof Promise) {
        return result.then((resolved) => {
          if (planState) {
            setDismissPlanSignal(signal => signal + 1)
          }
          return resolved
        })
      }
      if (planState) {
        setDismissPlanSignal(signal => signal + 1)
      }
      return result
    },
    [composerRuntime, onUpdateQueueItem, planState, runtimeSettings],
  )

  const handleComposerDraftChange = useCallback((value: string) => {
    setComposerHasDraft(Boolean(value.trim()))
  }, [])

  const handleEditQueueItem = useCallback((item: ChatQueueItem) => {
    editingQueueItemIdRef.current = item.id
    setEditingQueueItemId(item.id)
    setComposerReplaceDraft({
      text: item.text,
      contextParts: item.contextParts,
    })
    setComposerReplaceDraftKey(key => key + 1)
    if (item.files.length > 0) {
      appshotRuntime.appendFileParts(item.files)
    }
    if (item.runtimeSettings) {
      runtimeSettings?.onChange({
        accessMode: item.runtimeSettings.accessMode,
        interactionMode: item.runtimeSettings.interactionMode,
      })
    }
  }, [appshotRuntime, runtimeSettings])

  useEffect(() => {
    if (!rollbackDraftSignal) {
      return
    }
    setComposerReplaceDraft(rollbackDraftSignal.draft)
    setComposerReplaceDraftKey(key => key + 1)
  }, [rollbackDraftSignal])

  // If the item being edited leaves the pending queue (claimed/cancelled),
  // abandon the edit so the next submit enqueues normally.
  useEffect(() => {
    if (!editingQueueItemId) {
      return
    }
    const stillPending = queueItems.some(
      item => item.id === editingQueueItemId && item.status === 'pending',
    )
    if (!stillPending) {
      editingQueueItemIdRef.current = null
      setEditingQueueItemId(null)
    }
  }, [editingQueueItemId, queueItems])

  useEffect(() => {
    if (!activePlanRefineTabId || planRefineEditorOpen) {
      return
    }
    setActivePlanRefineTabId(null)
  }, [activePlanRefineTabId, planRefineEditorOpen])

  useEffect(() => {
    const handlePlanRefineSave = (event: Event) => {
      if (
        !(event instanceof CustomEvent)
        || typeof event.detail !== 'object'
        || event.detail === null
      ) {
        return
      }
      const detail = event.detail as Partial<PlanRefineEditorSaveDetail>
      if (
        typeof detail.tabId !== 'string'
        || typeof detail.markdown !== 'string'
        || detail.tabId !== activePlanRefineTabId
      ) {
        return
      }
      event.preventDefault()
      setComposerReplaceText(`${CODEX_PLAN_REFINE_PROMPT_PREFIX}\n${detail.markdown}`.trimEnd())
      setComposerReplaceTextKey(key => key + 1)
      setActivePlanRefineTabId(null)
    }

    window.addEventListener(PLAN_REFINE_EDITOR_SAVE_EVENT, handlePlanRefineSave)
    return () => {
      window.removeEventListener(PLAN_REFINE_EDITOR_SAVE_EVENT, handlePlanRefineSave)
    }
  }, [activePlanRefineTabId])

  const planSlotActions = useMemo<ComposerPlanSlotActions>(() => {
    const sendPlanFollowUp = async (
      prompt: string,
      options?: { runtimeSettings?: SendMessageOptions['runtimeSettings'] },
    ) => {
      try {
        await submitComposerMessage(prompt, [], [], options)
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Plan action failed',
          description: error instanceof Error ? error.message : 'Unknown plan action error.',
        })
        return false
      }
      setComposerReplaceText('')
      setComposerReplaceTextKey(key => key + 1)
      return true
    }

    return {
      ...planActions,
      disabled:
        planActions?.disabled
        || composerRuntime.disabled
        || composerRuntime.isStreaming
        || planRefineEditorOpen,
      onImplement: (state) => {
        const handled = planActions?.onImplement?.(state)
        if (handled !== undefined) {
          return handled
        }
        runtimeSettings?.onChange({ interactionMode: 'default' })
        return sendPlanFollowUp(CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX, {
          runtimeSettings: { interactionMode: 'default' },
        })
      },
      onMakeGoal: (state) => {
        const handled = planActions?.onMakeGoal?.(state)
        if (handled !== undefined) {
          return handled
        }
        runtimeSettings?.onChange({ interactionMode: 'default' })
        return sendPlanFollowUp(CODEX_PLAN_MAKE_GOAL_PROMPT_PREFIX, {
          runtimeSettings: { interactionMode: 'default' },
        })
      },
      onRefine: (state) => {
        const handled = planActions?.onRefine?.(state)
        if (handled !== undefined) {
          return handled
        }
        const content = readPlanSlotContent(state)
        const requestId = [
          sessionId ?? 'global',
          state.slotId,
          String(state.updatedAt),
          hashPlanRefineRequestContent(content),
        ].join(':')
        const tabId = openPlanRefineTab({
          sessionId,
          requestId,
          title: 'Plan',
          text: content,
          ownerId: activeBrowserPanelOwnerId,
        })
        setActivePlanRefineTabId(tabId)
        setBrowserPanelOpen(true, activeBrowserPanelOwnerId)
        return false
      },
    }
  }, [
    activeBrowserPanelOwnerId,
    composerRuntime.disabled,
    composerRuntime.isStreaming,
    openPlanRefineTab,
    planActions,
    planRefineEditorOpen,
    runtimeSettings,
    sessionId,
    setBrowserPanelOpen,
    submitComposerMessage,
  ])

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-208 bg-transparent">
      <ChatAwaitBanner awaitSummary={awaitSummary} />
      <ChatQueueList
        items={queueItems}
        onCancel={onCancelQueueItem}
        onReorder={onReorderQueueItems}
        onEdit={handleEditQueueItem}
        editingItemId={editingQueueItemId}
        className="relative z-20 mb-2"
      />
      <div className="relative">
        <div className="pointer-events-auto absolute inset-x-0 bottom-full z-10 -mb-px">
          <ComposerSlotStates
            sessionId={sessionId}
            slots={composerRuntime.uiSlots}
            states={composerRuntime.slotStates}
            actions={goalActions}
            plan={planSlotActions}
            quickQuestion={quickQuestionSlot}
            review={reviewSlot}
            usage={usageSlot}
            dismissPlanSignal={dismissPlanSignal}
            hidePlan={composerHasDraft}
          />
        </div>
        <Composer
          send={{
            submit: submitComposerMessage,
            stop: composerRuntime.stop,
            isStreaming: composerRuntime.isStreaming,
            disabled: composerRuntime.disabled || planRefineEditorOpen,
            onQuickQuestion,
          }}
          commands={{
            commands: composerRuntime.slashCommands,
            runAction: onSlashCommandAction,
          }}
          attachments={{
            supportsAttachments: composerRuntime.supportsAttachments,
            appendFileParts: appshotRuntime.externalFileParts,
            appendFilePartsKey: appshotRuntime.externalFilePartsKey,
            pendingAppshots: appshotRuntime.pendingAppshots,
            onActionTargetElementChange: appshotRuntime.setActionTargetElement,
          }}
          runtimeSettings={runtimeSettings}
          slots={{
            toolbar,
            contextBar,
          }}
          externalSignals={{
            appendText: droppedPath ? `${droppedPath.text}` : undefined,
            appendTextKey: droppedPath?.ts,
            clearDraftKey: clearDraftSignal,
            suspendDraftPersistence,
            replaceText: composerReplaceText,
            replaceTextKey: composerReplaceTextKey,
            replaceDraft: composerReplaceDraft,
            replaceDraftKey: composerReplaceDraftKey,
          }}
          view={{
            placeholder,
            availableFiles,
            searchFiles,
            searchPlugins,
            searchSkills,
            textareaRows: 3,
            onDraftChange: handleComposerDraftChange,
            onFocusChange: onComposerFocusChange,
            sessionId,
            sessionTokens: composerRuntime.tokenUsage?.tokens,
            sessionContextWindow: composerRuntime.tokenUsage?.contextWindow,
            compactState: composerRuntime.compactState,
            surfaceId: sessionId ? chatSurfaceId(sessionId) : undefined,
          }}
        />
      </div>
    </div>
  )
}

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
    apiBaseUrl: getServerUrl(),
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
      apiBaseUrl: quickQuestion.apiBaseUrl,
      onDismiss: quickQuestion.closeQuickQuestion,
    }),
    [
      hasQuickQuestionSlot,
      quickQuestion.apiBaseUrl,
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
        <button
          type="button"
          aria-label={t('rollback.editor.cancel')}
          title={t('rollback.editor.cancel')}
          onClick={cancelPendingRollbackEdit}
          className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-warning-foreground/70 transition-[background-color,color,scale] duration-150 hover:bg-warning/15 hover:text-warning-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40 before:absolute before:-inset-2"
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
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
      method: 'thread/goal/set' | 'thread/goal/clear',
      params: Record<string, unknown>,
      failureTitle: string,
    ) => {
      if (!sessionId) {
        return
      }

      setGoalActionBusy(true)
      try {
        await postChatSessionsBySessionIdCodexAppServerInvoke({
          path: { sessionId },
          body: { method, params },
          throwOnError: true,
        })
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
          'thread/goal/set',
          {
            threadId: state.threadId,
            status: 'paused',
          },
          'Goal pause failed',
        )
      },
      onResume: (state: ChatRuntimeGoalUiSlotState) => {
        void invokeCodexGoalAction(
          'thread/goal/set',
          {
            threadId: state.threadId,
            status: 'active',
          },
          'Goal resume failed',
        )
      },
      onClear: (state: ChatRuntimeGoalUiSlotState) => {
        void invokeCodexGoalAction(
          'thread/goal/clear',
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
        'thread/goal/set',
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
      if (command.action.actionId === CODEX_REVIEW_SLASH_ACTION_ID) {
        setReviewModeOpen(true)
        return { insertText: '' }
      }
      if (command.action.actionId === CODEX_USAGE_SLASH_ACTION_ID) {
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
      const url = new URL(
        `/workspaces/${encodeURIComponent(workspaceId)}/git/merge-base`,
        getServerUrl(),
      )
      url.searchParams.set('baseBranch', baseBranch)
      if (repositoryPath) {
        url.searchParams.set('repo', repositoryPath)
      }
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to resolve merge base (${response.status}).`)
      }
      const payload = (await response.json()) as { mergeBaseSha?: unknown }
      return typeof payload.mergeBaseSha === 'string' ? payload.mergeBaseSha : null
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

      <Dialog open={editingGoal !== null} onOpenChange={open => !open && closeGoalEditor()}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={submitGoalEditor}>
            <DialogHeader>
              <DialogTitle>Edit goal</DialogTitle>
              <DialogDescription>
                Update the active goal without sending a chat message.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={goalObjectiveDraft}
              onChange={event => setGoalObjectiveDraft(event.target.value)}
              disabled={goalActionBusy}
              autoFocus
              rows={4}
              className="max-h-48 resize-none"
              aria-label="Goal objective"
            />
            <DialogFooter variant="bare">
              <Button
                type="button"
                variant="outline"
                disabled={goalActionBusy}
                onClick={closeGoalEditor}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={goalActionBusy || goalObjectiveDraft.trim().length === 0}
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
