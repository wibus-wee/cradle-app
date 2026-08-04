import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toastManager } from '~/components/ui/toast'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { chatSurfaceId } from '~/navigation/surface-identity'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useChatStore } from '~/store/chat'
import type { ComposerDraft } from '~/store/composer-draft'

import type { PlanRefineEditorSaveDetail } from '../../browser/plan-refine-editor'
import { PLAN_REFINE_EDITOR_SAVE_EVENT } from '../../browser/plan-refine-editor'
import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimePlanUiSlotState,
} from '../capabilities/chat-capabilities'
import { annotateBangCommandMessage, annotateBangResultMessage } from '../commands/bang-command-metadata'
import type { ChatQueueEnqueueBody, ChatQueueItem } from '../commands/chat-response-command'
import { persistBangTranscript } from '../commands/chat-response-command'
import type {
  ComposerSlashCommandActionContext,
  ComposerSlashCommandActionResult,
  ComposerSlashCommandActionTools,
} from '../composer/composer-action-context'
import {
  consumeComposerInsert,
  useComposerInsertStore,
} from '../composer/composer-insert'
import type {
  ComposerPlanSlotActions,
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from '../composer/composer-slot-states'
import { ComposerSlotStates } from '../composer/composer-slot-states'
import { ComposerBangPtyContainer } from '../composer/containers/composer-bang-pty-container'
import type { ComposerDecoration, ComposerRuntimeSettingsController } from '../composer/containers/composer-container'
import { Composer } from '../composer/containers/composer-container'
import type { ChatComposerRuntime } from '../composer/use-chat-composer-runtime'
import type { ComposerAppshotRuntime } from '../composer/use-composer-appshot-capture'
import type { ChatContextPart } from '../context/chat-context-parts'
import type { MentionItem, PluginMentionItem } from '../mentions/mention-panel'
import type { SkillMentionItem } from '../mentions/skill-mention-panel'
import { buildExitPlanModePatch } from '../runtime/runtime-settings-presenter'
import type { SendMessageOptions, SendMessageResult } from '../session/use-chat-session'
import type { useSessionAwaitSummary } from '../session/use-session-await'
import type { ChatComposerSlashCommand } from '../slash-commands/chat-slash-commands'
import { ChatAwaitBanner } from './chat-await-banner'
import { ChatQueueList } from './chat-queue-list'

const CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:'
const CODEX_PLAN_MAKE_GOAL_PROMPT_PREFIX = 'PLEASE MAKE A GOAL TO IMPLEMENT THIS PLAN:'
const CODEX_PLAN_REFINE_PROMPT_PREFIX = 'PLEASE REFINE THIS PLAN:'

type ComposerReplaceDraft = ComposerDraft

export type RollbackDraftSignal = {
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

export function ChatComposerSection({
  sessionId,
  workspacePath = null,
  runtimeKind = null,
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
  composerDecoration = null,
  rollbackDraftSignal,
  clearDraftSignal,
  suspendDraftPersistence,
  promptHistory,
  contextIngress,
}: {
  sessionId: string | null
  /** Absolute local workspace path; required for Composer bang PTY. */
  workspacePath?: string | null
  runtimeKind?: RuntimeKind | null
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
  toolbar?: ReactNode
  runtimeSettings?: ComposerRuntimeSettingsController
  contextBar?: ReactNode
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
  composerDecoration?: ComposerDecoration | null
  rollbackDraftSignal?: RollbackDraftSignal | null
  clearDraftSignal?: number
  suspendDraftPersistence?: boolean
  promptHistory?: ComposerDraft[]
  contextIngress?: {
    parts: ChatContextPart[]
    key: number
  } | null
}) {
  const activeBrowserPanelOwnerId = useBrowserPanelStore(s => s.activeOwnerId)
  const openPlanRefineTab = useBrowserPanelStore(s => s.openPlanRefineTab)
  const [composerReplaceText, setComposerReplaceText] = useState<string | undefined>(undefined)
  const [composerReplaceTextKey, setComposerReplaceTextKey] = useState(0)
  const [composerReplaceDraft, setComposerReplaceDraft] = useState<
    ComposerReplaceDraft | undefined
  >(undefined)
  const [composerReplaceDraftKey, setComposerReplaceDraftKey] = useState(0)
  const [composerAppendText, setComposerAppendText] = useState<string | undefined>(undefined)
  const [composerAppendTextKey, setComposerAppendTextKey] = useState<number | undefined>(undefined)
  const [composerAppendTextCreatedAt, setComposerAppendTextCreatedAt] = useState<number | undefined>(undefined)
  const [dismissPlanSignal, setDismissPlanSignal] = useState(0)
  const [composerHasDraft, setComposerHasDraft] = useState(false)
  const [activePlanRefineTabId, setActivePlanRefineTabId] = useState<string | null>(null)
  const [bangPtyOpen, setBangPtyOpen] = useState(false)
  const bangPtyActionsRef = useRef<import('../composer/containers/composer-bang-pty-container').ComposerBangPtyActions | null>(null)
  const editingQueueItemIdRef = useRef<string | null>(null)
  const [editingQueueItemId, setEditingQueueItemId] = useState<string | null>(null)
  const bangPtyEnabled = Boolean(sessionId && workspacePath)
  const pendingComposerInsert = useComposerInsertStore(
    state => sessionId ? state.requests[sessionId]?.[0] ?? null : null,
  )
  const shouldAppendComment = composerAppendTextCreatedAt !== undefined
    && (droppedPath === null || composerAppendTextCreatedAt >= droppedPath.ts)
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
    (
      ...args: Parameters<ChatComposerRuntime['send']>
    ): SendMessageResult | Promise<SendMessageResult> => {
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
    setComposerHasDraft(Boolean(value.trim()) || bangPtyOpen)
  }, [bangPtyOpen])

  useEffect(() => {
    if (bangPtyOpen) {
      setComposerHasDraft(true)
    }
  }, [bangPtyOpen])

  const handleEditQueueItem = useCallback(
    (item: ChatQueueItem) => {
      editingQueueItemIdRef.current = item.id
      setEditingQueueItemId(item.id)
      setComposerReplaceDraft({
        text: item.text,
        contextParts: item.contextParts,
        files: item.files,
        pastedTexts: [],
      })
      setComposerReplaceDraftKey(key => key + 1)
      if (item.runtimeSettings) {
        runtimeSettings?.onChange(item.runtimeSettings)
      }
    },
    [runtimeSettings],
  )

  useEffect(() => {
    if (!sessionId || !pendingComposerInsert) {
      return
    }
    setComposerAppendText(pendingComposerInsert.text)
    setComposerAppendTextKey(pendingComposerInsert.id)
    setComposerAppendTextCreatedAt(pendingComposerInsert.createdAt)
    consumeComposerInsert(sessionId, pendingComposerInsert.id)
  }, [pendingComposerInsert, sessionId])

  useEffect(() => {
    if (!rollbackDraftSignal) {
      return
    }
    setComposerReplaceDraft(rollbackDraftSignal.draft)
    setComposerReplaceDraftKey(key => key + 1)
  }, [rollbackDraftSignal])

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
        const exitPlanPatch = buildExitPlanModePatch(runtimeKind)
        runtimeSettings?.onChange(exitPlanPatch)
        return sendPlanFollowUp(CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX, {
          runtimeSettings: exitPlanPatch,
        })
      },
      onMakeGoal: (state) => {
        const handled = planActions?.onMakeGoal?.(state)
        if (handled !== undefined) {
          return handled
        }
        const exitPlanPatch = buildExitPlanModePatch(runtimeKind)
        runtimeSettings?.onChange(exitPlanPatch)
        return sendPlanFollowUp(CODEX_PLAN_MAKE_GOAL_PROMPT_PREFIX, {
          runtimeSettings: exitPlanPatch,
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
    runtimeKind,
    runtimeSettings,
    sessionId,
    submitComposerMessage,
  ])

  useEffect(() => {
    setBangPtyOpen(false)
  }, [sessionId])

  const handleBangPtyPersisted = useCallback((result: import('../commands/chat-response-command').BangCommandResult) => {
    if (!sessionId) {
      return
    }
    const store = useChatStore.getState()
    const latestMessages = store.messagesMap.get(sessionId) ?? []
    const userMessage = annotateBangCommandMessage(result.userMessage, result.command)
    const resultMessage = annotateBangResultMessage(result.resultMessage, {
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      truncated: result.truncated,
    })
    if (!latestMessages.some(message => message.id === userMessage.id)) {
      store.appendMessage(sessionId, userMessage)
    }
    if (!latestMessages.some(message => message.id === resultMessage.id)) {
      store.appendMessage(sessionId, resultMessage)
    }
  }, [sessionId])

  const bangPtySurface = bangPtyEnabled && sessionId && workspacePath
    ? (
        <ComposerBangPtyContainer
          sessionId={sessionId}
          workspacePath={workspacePath}
          open={bangPtyOpen}
          onClose={() => setBangPtyOpen(false)}
          onPersisted={handleBangPtyPersisted}
          persistTranscript={persistBangTranscript}
          actionsRef={bangPtyActionsRef}
        />
      )
    : null

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-208 bg-transparent">
      <ChatAwaitBanner awaitSummary={awaitSummary} />
      <ChatQueueList
        items={queueItems}
        runtimeKind={runtimeKind}
        onCancel={onCancelQueueItem}
        onReorder={onReorderQueueItems}
        onEdit={handleEditQueueItem}
        editingItemId={editingQueueItemId}
        className="relative z-20 mb-2"
      />
      <div className="relative">
        <div className="pointer-events-auto relative z-10 -mb-px">
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
            isStreaming: composerRuntime.canStop,
            disabled: composerRuntime.disabled || planRefineEditorOpen,
            onQuickQuestion,
          }}
          commands={{
            commands: composerRuntime.slashCommands,
            runAction: onSlashCommandAction,
          }}
          attachments={{
            supportsAttachments: composerRuntime.supportsAttachments,
            usesLightOcr: composerRuntime.usesLightOcr,
            appendFileParts: appshotRuntime.externalFileParts,
            appendFilePartsKey: appshotRuntime.externalFilePartsKey,
            pendingAppshots: appshotRuntime.pendingAppshots,
            onActionTargetElementChange: appshotRuntime.setActionTargetElement,
          }}
          runtimeSettings={runtimeSettings}
          decoration={composerDecoration}
          slots={{
            toolbar,
            contextBar,
            bangPty: bangPtyEnabled
              ? {
                  enabled: true,
                  active: bangPtyOpen,
                  surface: bangPtySurface,
                  onEnter: () => setBangPtyOpen(true),
                  onWriteBack: () => bangPtyActionsRef.current?.writeBack(),
                  onDiscard: () => bangPtyActionsRef.current?.discard(),
                }
              : undefined,
          }}
          externalSignals={{
            appendText: shouldAppendComment ? composerAppendText : (droppedPath ? `${droppedPath.text}` : undefined),
            appendTextKey: shouldAppendComment ? composerAppendTextKey : droppedPath?.ts,
            appendContextParts: contextIngress?.parts,
            appendContextPartsKey: contextIngress?.key,
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
            runtimeUsageState: composerRuntime.usageState,
            surfaceId: sessionId ? chatSurfaceId(sessionId) : undefined,
            promptHistory,
          }}
        />
      </div>
    </div>
  )
}
