import type { UIMessage } from 'ai'
import isEqual from 'fast-deep-equal'
import type { Draft } from 'immer'
import { enableMapSet, produce } from 'immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { createWithEqualityFn } from 'zustand/traditional'

import {
  applyDisplaySplits,
  findActiveAssistantId,
  getQueueItemId,
  hasVisibleParts,
  hydrateDisplaySplits,
  projectStreamingThroughSplits,
  reconcileMessage,
  reconcileMessages,
} from './helpers'
import { getChatStoreTelemetrySnapshot as buildTelemetrySnapshot } from './telemetry'
import type {
  AssistantDisplaySplit,
  ChatActiveGoal,
  ChatError,
  ChatRunDisplayMeta,
  ChatRunState,
  ChatState,
  MessagePart,
  MessageStreamLease,
  PassiveRunStateInput,
  PublicStatus,
} from './types'
import { DEFAULT_CHAT_RUN_STATE, EMPTY_MESSAGES } from './types'

enableMapSet()

// ── Store ────────────────────────────────────────────────────

export function createChatStore() {
  return createWithEqualityFn<ChatState>()(
    subscribeWithSelector(
      (set, get) => ({
      messagesMap: new Map(),
      hydratedSessionIds: new Set(),
      runStateMap: new Map(),
      streamLeaseMap: new Map(),
      activeAbortControllers: new Map(),
      runDisplayMetaMap: new Map(),
      errorMap: new Map(),
      activeGoalMap: new Map(),
      assistantDisplaySplitMap: new Map(),

      // ── Messages ─────────────────────────────────────────

      setMessages: (sessionId, messages) => {
        set((state) => {
          const splits = hydrateDisplaySplits(messages, state.assistantDisplaySplitMap)
          const displayed = preserveLeasedMessages(
            sessionId,
            state.messagesMap.get(sessionId),
            applyDisplaySplits(messages, splits),
            state.streamLeaseMap,
          )
          const current = state.messagesMap.get(sessionId)
          const next = current ? reconcileMessages(current, displayed) : displayed
          const splitsChanged = splits !== state.assistantDisplaySplitMap

          const currentIds = new Set((current ?? []).map(m => m.id))
          const nextIds = new Set(displayed.map(m => m.id))
          const removed = [...currentIds].filter(id => !nextIds.has(id))

          const currentRunState = readSessionRunState(state, sessionId)
          const removedActiveMessage = currentRunState.phase === 'streaming'
            && currentRunState.source === 'passive'
            && removed.includes(currentRunState.messageId)

          if (current === next && !splitsChanged && !removedActiveMessage) {
            return state
          }

          return produce(state, (draft) => {
            draft.messagesMap.set(sessionId, next)
            if (splitsChanged) {
              draft.assistantDisplaySplitMap = splits as Draft<Map<string, AssistantDisplaySplit>>
            }
            for (const id of removed) {
              draft.errorMap.delete(id)
            }
            if (removedActiveMessage) {
              draft.runStateMap.set(sessionId, DEFAULT_CHAT_RUN_STATE)
            }
          })
        })
      },

      updateMessage: (sessionId, messageId, updater, change) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages) { return state }
          const idx = messages.findIndex(m => m.id === messageId)
          if (idx === -1) { return state }

          const updated = reconcileMessage(messages[idx], updater(messages[idx]), change)
          if (updated === messages[idx]) { return state }

          const nextMessages = messages.slice()
          nextMessages[idx] = updated
          const nextMap = new Map(state.messagesMap)
          nextMap.set(sessionId, nextMessages)

          if (updated.id !== messageId) {
            return { messagesMap: nextMap, ...migrateDisplaySplit(state, nextMap, messageId, updated.id) }
          }
          return { messagesMap: nextMap }
        })
      },

      appendMessage: (sessionId, message) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          const nextMap = new Map(state.messagesMap)
          nextMap.set(sessionId, messages ? [...messages, message] : [message])
          return { messagesMap: nextMap }
        })
      },

      insertLiveSteerMessage: (sessionId, message, sourceMessageId) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages) { return state }

          const queueItemId = getQueueItemId(message)
          if (messages.some(m => m.id === message.id || (queueItemId && getQueueItemId(m) === queueItemId))) {
            return state
          }

          const runState = readSessionRunState(state, sessionId)
          const activeMessageId = readRunStateMessageId(runState)
          const effectiveSourceId = sourceMessageId ?? findActiveAssistantId(
            messages,
            readStreamingMessageIds(state),
            activeMessageId,
          )
          const sourceIdx = effectiveSourceId
            ? messages.findIndex(m => m.id === effectiveSourceId && m.role === 'assistant')
            : -1

          if (sourceIdx === -1) {
            const nextMap = new Map(state.messagesMap)
            nextMap.set(sessionId, [...messages, message])
            return { messagesMap: nextMap }
          }

          return produce(state, (draft) => {
            const sourceMessage = messages[sourceIdx]
            const split = state.assistantDisplaySplitMap.get(sourceMessage.id)
            const tailMessageId = split?.tailMessageId ?? `${sourceMessage.id}:steer-tail`
            const sourceHead = trimTrailingEmptyParts(split ? sourceMessage.parts : structuredClone(sourceMessage.parts) as MessagePart[])
            const tailMessage = { ...sourceMessage, id: tailMessageId, parts: projectTailFromHead(sourceMessage.parts, sourceHead) }
            const shouldKeepTail = isStreamingMessageId(state, sourceMessage.id)
              || activeMessageId === sourceMessage.id

            const insertedMessageIds = split ? [...split.insertedMessageIds, message.id] : [message.id]
            const insertedQueueItemIds = queueItemId
              ? split ? [...split.insertedQueueItemIds.filter(id => id !== queueItemId), queueItemId] : [queueItemId]
              : split?.insertedQueueItemIds ?? []

            const nextMessages = [
              ...messages.slice(0, sourceIdx),
              { ...sourceMessage, parts: sourceHead },
              message,
              ...(shouldKeepTail || hasVisibleParts(tailMessage.parts) ? [tailMessage] : []),
              ...messages.slice(sourceIdx + 1).filter(m => m.id !== tailMessageId),
            ]

            draft.messagesMap.set(sessionId, nextMessages as Draft<UIMessage[]>)
            draft.assistantDisplaySplitMap.set(sourceMessage.id, {
              sourceMessageId: sourceMessage.id,
              tailMessageId,
              splitParts: structuredClone(sourceHead) as Draft<MessagePart[]>,
              insertedMessageIds,
              insertedQueueItemIds,
            } as Draft<AssistantDisplaySplit>)

            if (shouldKeepTail) {
              moveStreamingRefs(draft, state, sessionId, sourceMessage.id, tailMessageId)
            }
          })
        })
      },

      removeMessage: (sessionId, messageId) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages?.some(m => m.id === messageId)) { return state }

          return produce(state, (draft) => {
            const draftMsgs = draft.messagesMap.get(sessionId)!
            const idx = draftMsgs.findIndex(m => m.id === messageId)
            if (idx !== -1) { draftMsgs.splice(idx, 1) }
            draft.activeAbortControllers.delete(messageId)
            draft.streamLeaseMap.delete(messageId)
            draft.runDisplayMetaMap.delete(messageId)
            draft.errorMap.delete(messageId)
            const runState = readSessionRunState(draft, sessionId)
            if (readRunStateMessageId(runState) === messageId) {
              draft.runStateMap.set(sessionId, DEFAULT_CHAT_RUN_STATE)
            }
          })
        })
      },

      // ── Streaming ────────────────────────────────────────

      startGeneration: (sessionId, messageId, controller) => {
        set((state) => {
          const nextError = new Map(state.errorMap)
          for (const m of state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES) { nextError.delete(m.id) }
          const nextAbort = new Map(state.activeAbortControllers)
          nextAbort.set(messageId, controller)
          const nextLease = new Map(state.streamLeaseMap)
          nextLease.set(messageId, { sessionId, runId: state.runDisplayMetaMap.get(messageId)?.runId ?? null, source: 'local' })
          const nextRunState = new Map(state.runStateMap)
          nextRunState.set(sessionId, { phase: 'streaming', source: 'local', messageId })
          return { errorMap: nextError, activeAbortControllers: nextAbort, streamLeaseMap: nextLease, runStateMap: nextRunState }
        })
      },

      finishGeneration: (messageId) => {
        set((state) => {
          const ids = getRunMessageIds(state, messageId)
          const nextAbort = new Map(state.activeAbortControllers)
          const nextRun = new Map(state.runDisplayMetaMap)
          const nextLease = new Map(state.streamLeaseMap)
          for (const id of ids) {
            nextAbort.delete(id)
            nextLease.delete(id)
            const rm = nextRun.get(id)
            if (rm && rm.completedAtMs === null) { nextRun.set(id, { ...rm, completedAtMs: performance.now() }) }
          }
          const nextRunState = new Map(state.runStateMap)
          for (const [sid, runState] of state.runStateMap) {
            const activeMessageId = readRunStateMessageId(runState)
            if (activeMessageId && ids.includes(activeMessageId)) {
              nextRunState.set(sid, DEFAULT_CHAT_RUN_STATE)
            }
          }
          return { activeAbortControllers: nextAbort, runDisplayMetaMap: nextRun, streamLeaseMap: nextLease, runStateMap: nextRunState }
        })
      },

      failGeneration: (messageId, error) => {
        set((state) => {
          const ids = getRunMessageIds(state, messageId)
          const visibleId = ids.at(-1) ?? messageId
          const nextAbort = new Map(state.activeAbortControllers)
          const nextRun = new Map(state.runDisplayMetaMap)
          const nextLease = new Map(state.streamLeaseMap)
          for (const id of ids) {
            nextAbort.delete(id)
            nextLease.delete(id)
            const rm = nextRun.get(id)
            if (rm && rm.completedAtMs === null) { nextRun.set(id, { ...rm, completedAtMs: performance.now() }) }
          }
          const nextError = new Map(state.errorMap)
          nextError.set(visibleId, { message: error, timestamp: Date.now() })
          const nextRunState = new Map(state.runStateMap)
          for (const [sid, runState] of state.runStateMap) {
            const activeMessageId = readRunStateMessageId(runState)
            if (activeMessageId && ids.includes(activeMessageId)) {
              nextRunState.set(sid, { phase: 'idle', error: true })
            }
          }
          return { activeAbortControllers: nextAbort, runDisplayMetaMap: nextRun, streamLeaseMap: nextLease, errorMap: nextError, runStateMap: nextRunState }
        })
      },

      stopGeneration: (messageId, sessionId) => {
        const controller = get().activeAbortControllers.get(messageId)
        if (controller) { controller.abort() }
        get().finishGeneration(messageId)
        get().setRunCancelling(sessionId, true)
      },

      setRunCancelling: (sessionId, cancelling) => {
        set((state) => {
          const current = readSessionRunState(state, sessionId)
          const next = resolveRunCancellingState(current, cancelling)
          if (isEqual(current, next)) { return state }
          const nextRunState = new Map(state.runStateMap)
          nextRunState.set(sessionId, next)
          return { runStateMap: nextRunState }
        })
      },

      acquireStreamLease: (input) => {
        set(state => acquireStreamLease_immutable(state, input))
      },

      moveStreamLease: (sessionId, from, to) => {
        if (from === to) { return }
        set(state => moveStreamingRefs_immutable(state, sessionId, from, to))
      },

      releaseStreamLease: (messageId) => {
        set(state => releaseStreamLease_immutable(state, messageId))
      },

      moveStreamingMessage: (sessionId, from, to) => {
        if (from === to) { return }
        set(state => moveStreamingRefs_immutable(state, sessionId, from, to))
      },

      setPassiveRunState: (sessionId, input) => {
        set(state => applyPassiveRunState(state, sessionId, input))
      },

      beginRunDisplayMeta: (messageId, requestStartedAtMs) => {
        set((state) => {
          const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
          const displayMeta = state.runDisplayMetaMap.get(displayMessageId)
          const sourceMeta = state.runDisplayMetaMap.get(messageId)
          const c = displayMeta ?? sourceMeta
          const needsMigration = displayMessageId !== messageId && state.runDisplayMetaMap.has(messageId)
          if (c?.requestStartedAtMs === requestStartedAtMs && c.completedAtMs === null && !needsMigration) { return state }
          const next = new Map(state.runDisplayMetaMap)
          if (displayMessageId !== messageId) {
            next.delete(messageId)
          }
          next.set(displayMessageId, { runId: c?.runId ?? null, requestStartedAtMs, acceptedAtMs: c?.acceptedAtMs ?? null, firstEventAtMs: c?.firstEventAtMs ?? null, firstContentAtMs: c?.firstContentAtMs ?? null, completedAtMs: null })
          return { runDisplayMetaMap: next }
        })
      },

      setRunDisplayId: (messageId, runId) => {
        set((state) => {
          const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
          const displayMeta = state.runDisplayMetaMap.get(displayMessageId)
          const sourceMeta = state.runDisplayMetaMap.get(messageId)
          const c = displayMeta ?? sourceMeta
          const needsMigration = displayMessageId !== messageId && state.runDisplayMetaMap.has(messageId)
          const currentLease = state.streamLeaseMap.get(displayMessageId) ?? state.streamLeaseMap.get(messageId)
          const needsLeaseUpdate = currentLease ? currentLease.runId !== runId || displayMessageId !== messageId : false
          if (c?.runId === runId && c.completedAtMs === null && !needsMigration && !needsLeaseUpdate) { return state }
          const now = performance.now()
          const next = new Map(state.runDisplayMetaMap)
          if (displayMessageId !== messageId) {
            next.delete(messageId)
          }
          next.set(displayMessageId, {
            runId,
            requestStartedAtMs: c?.requestStartedAtMs ?? now,
            acceptedAtMs: c && (c.runId === null || c.runId === runId) ? c.acceptedAtMs : null,
            firstEventAtMs: c?.firstEventAtMs ?? null,
            firstContentAtMs: c?.firstContentAtMs ?? null,
            completedAtMs: null,
          })
          const nextLease = new Map(state.streamLeaseMap)
          if (currentLease) {
            nextLease.delete(messageId)
            nextLease.set(displayMessageId, { ...currentLease, runId })
          }
          return { runDisplayMetaMap: next, streamLeaseMap: nextLease }
        })
      },

      markRunAccepted: (messageId, ts) => {
        set((state) => {
          const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
          const displayMeta = state.runDisplayMetaMap.get(displayMessageId)
          const sourceMeta = state.runDisplayMetaMap.get(messageId)
          const c = displayMeta ?? sourceMeta
          const needsMigration = displayMessageId !== messageId && state.runDisplayMetaMap.has(messageId)
          if (!c || (c.acceptedAtMs !== null && !needsMigration)) { return state }
          const next = new Map(state.runDisplayMetaMap)
          if (displayMessageId !== messageId) {
            next.delete(messageId)
          }
          next.set(displayMessageId, { ...c, acceptedAtMs: c.acceptedAtMs ?? ts })
          return { runDisplayMetaMap: next }
        })
      },

      moveRunDisplayMeta: (from, to) => {
        if (from === to) { return }
        set((state) => {
          const c = state.runDisplayMetaMap.get(from)
          if (!c) { return state }
          const next = new Map(state.runDisplayMetaMap)
          next.delete(from)
          next.set(to, state.runDisplayMetaMap.get(to) ?? c)
          return { runDisplayMetaMap: next }
        })
      },

      markRunFirstEvent: (messageId, ts) => {
        set((state) => {
          const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
          const displayMeta = state.runDisplayMetaMap.get(displayMessageId)
          const sourceMeta = state.runDisplayMetaMap.get(messageId)
          const c = displayMeta ?? sourceMeta
          const needsMigration = displayMessageId !== messageId && state.runDisplayMetaMap.has(messageId)
          if (!c || (c.firstEventAtMs !== null && !needsMigration)) { return state }
          const next = new Map(state.runDisplayMetaMap)
          if (displayMessageId !== messageId) {
            next.delete(messageId)
          }
          next.set(displayMessageId, { ...c, firstEventAtMs: c.firstEventAtMs ?? ts })
          return { runDisplayMetaMap: next }
        })
      },

      markRunFirstContent: (messageId, ts) => {
        set((state) => {
          const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
          const displayMeta = state.runDisplayMetaMap.get(displayMessageId)
          const sourceMeta = state.runDisplayMetaMap.get(messageId)
          const c = displayMeta ?? sourceMeta
          const needsMigration = displayMessageId !== messageId && state.runDisplayMetaMap.has(messageId)
          if (!c || (c.firstContentAtMs !== null && !needsMigration)) { return state }
          const next = new Map(state.runDisplayMetaMap)
          if (displayMessageId !== messageId) {
            next.delete(messageId)
          }
          next.set(displayMessageId, { ...c, firstContentAtMs: c.firstContentAtMs ?? ts })
          return { runDisplayMetaMap: next }
        })
      },

      projectStreamingMessageForDisplay: (_sessionId, message) => {
        return projectStreamingThroughSplits(message, get().assistantDisplaySplitMap)
      },

      setSessionHydrated: (sessionId, hydrated) => {
        set((state) => {
          if (state.hydratedSessionIds.has(sessionId) === hydrated) { return state }
          const next = new Set(state.hydratedSessionIds)
          hydrated ? next.add(sessionId) : next.delete(sessionId)
          return { hydratedSessionIds: next }
        })
      },

      setActiveGoal: (sessionId, input) => {
        const objective = input.objective.trim()
        if (!objective) { return }
        set((state) => {
          const now = Math.floor(Date.now() / 1000)
          const current = state.activeGoalMap.get(sessionId)
          const next: ChatActiveGoal = {
            sessionId,
            objective,
            status: input.status ?? 'active',
            sourceMessageId: input.sourceMessageId ?? null,
            tokenBudget: input.tokenBudget ?? null,
            tokensUsed: current?.tokensUsed ?? 0,
            timeUsedSeconds: current?.timeUsedSeconds ?? 0,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
          }
          if (isEqual(current, next)) { return state }
          const nextMap = new Map(state.activeGoalMap)
          nextMap.set(sessionId, next)
          return { activeGoalMap: nextMap }
        })
      },

      clearActiveGoal: (sessionId) => {
        set((state) => {
          if (!state.activeGoalMap.has(sessionId)) { return state }
          const next = new Map(state.activeGoalMap)
          next.delete(sessionId)
          return { activeGoalMap: next }
        })
      },

      // ── Cleanup ──────────────────────────────────────────

      clearSession: (sessionId) => {
        set((state) => {
          const removed = new Set((state.messagesMap.get(sessionId) ?? []).map(m => m.id))
          for (const split of state.assistantDisplaySplitMap.values()) {
            if (removed.has(split.sourceMessageId)) {
              removed.add(split.tailMessageId)
              split.insertedMessageIds.forEach(id => removed.add(id))
            }
          }
          return produce(state, (draft) => {
            draft.messagesMap.delete(sessionId)
            draft.hydratedSessionIds.delete(sessionId)
            draft.runStateMap.delete(sessionId)
            draft.activeGoalMap.delete(sessionId)
            for (const [messageId, lease] of draft.streamLeaseMap) {
              if (lease.sessionId === sessionId) {
                draft.streamLeaseMap.delete(messageId)
              }
            }
            for (const id of removed) {
              draft.activeAbortControllers.delete(id)
              draft.runDisplayMetaMap.delete(id)
              draft.errorMap.delete(id)
            }
            for (const [srcId, split] of draft.assistantDisplaySplitMap) {
              if (removed.has(srcId) || removed.has(split.tailMessageId)) {
                draft.assistantDisplaySplitMap.delete(srcId)
              }
            }
          })
        })
      },

      clearError: (messageId) => {
        set((state) => {
          if (!state.errorMap.has(messageId)) { return state }
          const next = new Map(state.errorMap)
          next.delete(messageId)
          return { errorMap: next }
        })
      },

      clearSessionErrors: (sessionId) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES
          if (!messages.some(m => state.errorMap.has(m.id))) { return state }
          const next = new Map(state.errorMap)
          for (const m of messages) { next.delete(m.id) }
          return { errorMap: next }
        })
      },
      }),
    ),
    shallow,
  )
}

export const useChatStore = createChatStore()

// ── Selectors ────────────────────────────────────────────────

const EMPTY_IDS: string[] = []
const idsCache = new WeakMap<UIMessage[], string[]>()
const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>()
let streamingMessageIdsCache: Set<string> | null = null

function cachedIds(messages: UIMessage[]): string[] {
  if (messages === EMPTY_MESSAGES) { return EMPTY_IDS }
  let ids = idsCache.get(messages)
  if (!ids) {
    ids = messages.map(m => m.id)
    idsCache.set(messages, ids)
  }
  return ids
}

function readSessionRunState(state: Pick<ChatState, 'runStateMap'>, sessionId: string): ChatRunState {
  return state.runStateMap.get(sessionId) ?? DEFAULT_CHAT_RUN_STATE
}

function readRunStateMessageId(runState: ChatRunState): string | null {
  switch (runState.phase) {
    case 'submitting':
    case 'streaming':
      return runState.messageId
    case 'settling':
      return runState.messageId
    case 'idle':
      return null
  }
}

function readStreamingMessageIds(state: ChatState): Set<string> {
  const ids: string[] = []
  for (const [messageId] of state.streamLeaseMap) {
    if (!ids.includes(messageId)) {
      ids.push(messageId)
    }
  }
  for (const runState of state.runStateMap.values()) {
    if (runState.phase === 'submitting' && !ids.includes(runState.messageId)) {
      ids.push(runState.messageId)
    }
  }
  if (ids.length === 0) {
    return EMPTY_STREAMING_MESSAGE_IDS
  }
  const cachedIds = streamingMessageIdsCache
  if (
    cachedIds
    && cachedIds.size === ids.length
    && ids.every(id => cachedIds.has(id))
  ) {
    return cachedIds
  }

  streamingMessageIdsCache = new Set(ids)
  return streamingMessageIdsCache
}

function isStreamingMessageId(state: ChatState, messageId: string): boolean {
  if (state.streamLeaseMap.has(messageId)) {
    return true
  }
  for (const runState of state.runStateMap.values()) {
    if (runState.phase === 'submitting' && runState.messageId === messageId) {
      return true
    }
  }
  return false
}

function isLocalStreamingMessageId(state: ChatState, messageId: string): boolean {
  return state.streamLeaseMap.get(messageId)?.source === 'local'
}

function applyPassiveRunState(
  state: ChatState,
  sessionId: string,
  input: PassiveRunStateInput,
): ChatState | Partial<ChatState> {
  const current = readSessionRunState(state, sessionId)
  const next = resolvePassiveRunState(state, sessionId, current, input)
  if (isEqual(current, next)) {
    return state
  }
  const nextRunState = new Map(state.runStateMap)
  nextRunState.set(sessionId, next)
  return { runStateMap: nextRunState }
}

function resolvePassiveRunState(
  state: ChatState,
  sessionId: string,
  current: ChatRunState,
  input: PassiveRunStateInput,
): ChatRunState {
  if (
    current.phase === 'submitting'
    || (current.phase === 'streaming' && current.source === 'local')
  ) {
    return current
  }

  if (input.cancelling === true) {
    return {
      phase: 'settling',
      messageId: readRunStateMessageId(current),
      cancelling: true,
      error: false,
    }
  }

  if (input.status === 'error') {
    return { phase: 'idle', error: true }
  }

  if (input.status === 'streaming') {
    const messageId = readPassiveRunMessageId(state, sessionId, input.messageIds, input.allowMissingMessage ?? false)
    return messageId
      ? { phase: 'streaming', source: 'passive', messageId }
      : DEFAULT_CHAT_RUN_STATE
  }

  return DEFAULT_CHAT_RUN_STATE
}

function readPassiveRunMessageId(
  state: ChatState,
  sessionId: string,
  messageIds: string[],
  allowMissingMessage: boolean,
): string | null {
  const sessionMessageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))
  for (const messageId of messageIds) {
    const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
    if (sessionMessageIds.has(displayMessageId)) {
      return displayMessageId
    }
  }
  if (allowMissingMessage && messageIds[0]) {
    return resolveStreamingDisplayMessageId(state, messageIds[0])
  }
  return null
}

function resolveRunCancellingState(current: ChatRunState, cancelling: boolean): ChatRunState {
  if (cancelling) {
    return {
      phase: 'settling',
      messageId: readRunStateMessageId(current),
      cancelling: true,
      error: false,
    }
  }
  return current.phase === 'settling'
    ? DEFAULT_CHAT_RUN_STATE
    : current
}

function moveRunStateMessage(runState: ChatRunState, messageId: string): ChatRunState {
  switch (runState.phase) {
    case 'submitting':
      return { ...runState, messageId }
    case 'streaming':
      return { ...runState, messageId }
    case 'settling':
      return { ...runState, messageId }
    case 'idle':
      return runState
  }
}

function preserveLeasedMessages(
  sessionId: string,
  current: UIMessage[] | undefined,
  displayed: UIMessage[],
  leases: Map<string, MessageStreamLease>,
): UIMessage[] {
  if (!current || leases.size === 0) {
    return displayed
  }

  const currentById = new Map(current.map(message => [message.id, message]))
  let changed = false
  const seenIds = new Set<string>()
  const next = displayed.map((message) => {
    seenIds.add(message.id)
    const lease = leases.get(message.id)
    const currentMessage = currentById.get(message.id)
    if (lease?.sessionId === sessionId && currentMessage) {
      changed = changed || currentMessage !== message
      return currentMessage
    }
    return message
  })

  for (const message of current) {
    const lease = leases.get(message.id)
    if (lease?.sessionId === sessionId && !seenIds.has(message.id)) {
      next.push(message)
      changed = true
    }
  }

  return changed ? next : displayed
}

function acquireStreamLease_immutable(
  state: ChatState,
  input: {
    sessionId: string
    messageId: string
    runId?: string | null
    source: 'local' | 'passive'
  },
): ChatState | Partial<ChatState> {
  const messageId = resolveStreamingDisplayMessageId(state, input.messageId)
  const currentLease = state.streamLeaseMap.get(messageId)
  if (currentLease?.source === 'local' && input.source === 'passive') {
    return state
  }

  const currentRunState = readSessionRunState(state, input.sessionId)
  if (
    input.source === 'passive'
    && (
      currentRunState.phase === 'submitting'
      || (currentRunState.phase === 'streaming' && currentRunState.source === 'local')
    )
  ) {
    return state
  }

  const runId = input.runId ?? state.runDisplayMetaMap.get(messageId)?.runId ?? state.runDisplayMetaMap.get(input.messageId)?.runId ?? null
  const nextLease: MessageStreamLease = {
    sessionId: input.sessionId,
    runId,
    source: input.source,
  }
  const nextRunState: ChatRunState = {
    phase: 'streaming',
    source: input.source,
    messageId,
  }

  if (
    isEqual(currentLease, nextLease)
    && isEqual(currentRunState, nextRunState)
  ) {
    return state
  }

  const nextLeaseMap = new Map(state.streamLeaseMap)
  nextLeaseMap.delete(input.messageId)
  nextLeaseMap.set(messageId, nextLease)
  const nextRunStateMap = new Map(state.runStateMap)
  nextRunStateMap.set(input.sessionId, nextRunState)
  return {
    streamLeaseMap: nextLeaseMap,
    runStateMap: nextRunStateMap,
  }
}

function releaseStreamLease_immutable(state: ChatState, messageId: string): ChatState | Partial<ChatState> {
  const ids = getRunMessageIds(state, messageId)
  if (!ids.some(id => state.streamLeaseMap.has(id))) {
    return state
  }

  const nextLease = new Map(state.streamLeaseMap)
  const nextRun = new Map(state.runDisplayMetaMap)
  for (const id of ids) {
    nextLease.delete(id)
    const run = nextRun.get(id)
    if (run && run.completedAtMs === null) {
      nextRun.set(id, { ...run, completedAtMs: performance.now() })
    }
  }

  const nextRunState = new Map(state.runStateMap)
  for (const [sessionId, runState] of state.runStateMap) {
    const activeMessageId = readRunStateMessageId(runState)
    if (activeMessageId && ids.includes(activeMessageId)) {
      nextRunState.set(sessionId, DEFAULT_CHAT_RUN_STATE)
    }
  }

  return {
    streamLeaseMap: nextLease,
    runDisplayMetaMap: nextRun,
    runStateMap: nextRunState,
  }
}

export const chatSelectors = {
  messages: (sessionId: string) => (s: ChatState) =>
    s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES,

  messageIds: (sessionId: string) => (s: ChatState) =>
    cachedIds(s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES),

  messageCount: (sessionId: string) => (s: ChatState) =>
    s.messagesMap.get(sessionId)?.length ?? 0,

  message: (sessionId: string, messageId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).find(m => m.id === messageId),

  lastAssistantId: (sessionId: string) => (s: ChatState) => {
    const msgs = s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { return msgs[i].id }
    }
    return undefined
  },

  isGenerating: (messageId: string) => (s: ChatState) =>
    isLocalStreamingMessageId(s, messageId),

  isStreamingMessage: (messageId: string) => (s: ChatState) =>
    isStreamingMessageId(s, messageId),

  isVisibleStreamingMessage: (sessionId: string, messageId: string) => (s: ChatState) => {
    const runState = readSessionRunState(s, sessionId)
    const lease = s.streamLeaseMap.get(messageId)
    return lease?.sessionId === sessionId || readRunStateMessageId(runState) === messageId
  },

  isAnyGenerating: (s: ChatState) =>
    [...s.runStateMap.values()].some(runState => runState.phase === 'streaming' && runState.source === 'local'),

  isSessionGenerating: (sessionId: string) => (s: ChatState) => {
    const runState = readSessionRunState(s, sessionId)
    if (runState.phase === 'streaming' && runState.source === 'local') { return true }
    return false
  },

  isSessionStreaming: (sessionId: string) => (s: ChatState) => {
    const runState = readSessionRunState(s, sessionId)
    for (const lease of s.streamLeaseMap.values()) {
      if (lease.sessionId === sessionId) { return true }
    }
    return runState.phase === 'submitting'
  },

  error: (messageId: string) => (s: ChatState) => s.errorMap.get(messageId),

  latestError: (sessionId: string) => (s: ChatState) => {
    let latest: ChatError | undefined
    for (const m of s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES) {
      const err = s.errorMap.get(m.id)
      if (err && (!latest || err.timestamp > latest.timestamp)) { latest = err }
    }
    return latest
  },

  sessionRunState: (sessionId: string) => (s: ChatState) =>
    readSessionRunState(s, sessionId),

  activeGoal: (sessionId: string) => (s: ChatState) =>
    s.activeGoalMap.get(sessionId) ?? null,

  isSessionHydrated: (sessionId: string) => (s: ChatState) =>
    s.hydratedSessionIds.has(sessionId),

  visibleStatus: (sessionId: string) => (s: ChatState): PublicStatus => {
    const runState = readSessionRunState(s, sessionId)
    for (const lease of s.streamLeaseMap.values()) {
      if (lease.sessionId === sessionId) { return 'streaming' }
    }
    if (
      runState.phase === 'submitting'
    ) {
      return 'streaming'
    }
    if (runState.phase === 'settling' && runState.cancelling) { return 'idle' }
    if ((runState.phase === 'idle' || runState.phase === 'settling') && runState.error) { return 'error' }
    const msgs = s.errorMap.size > 0 ? s.messagesMap.get(sessionId) : undefined
    if (msgs?.some(m => s.errorMap.has(m.id))) { return 'error' }
    return 'idle'
  },

  runDisplayMeta: (messageId: string) => (s: ChatState) =>
    s.runDisplayMetaMap.get(messageId),

  streamingMessageIdSet: (s: ChatState) =>
    readStreamingMessageIds(s),
}

// ── Telemetry ────────────────────────────────────────────────

export function getChatStoreTelemetrySnapshot() {
  return buildTelemetrySnapshot(useChatStore.getState())
}

// ── Private Helpers ──────────────────────────────────────────

function getRunMessageIds(state: ChatState, messageId: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  let current: string | null = messageId
  while (current && !seen.has(current)) {
    ids.push(current)
    seen.add(current)
    current = state.assistantDisplaySplitMap.get(current)?.tailMessageId ?? null
  }
  return ids
}

function resolveStreamingDisplayMessageId(state: ChatState, messageId: string): string {
  return getRunMessageIds(state, messageId).at(-1) ?? messageId
}

function moveStreamingRefs(
  draft: Draft<ChatState>,
  state: ChatState,
  sessionId: string,
  from: string,
  to: string,
): void {
  if (from === to) { return }
  const ctrl = state.activeAbortControllers.get(from)
  const run = state.runDisplayMetaMap.get(from)
  const lease = state.streamLeaseMap.get(from)

  draft.activeAbortControllers.delete(from)
  draft.runDisplayMetaMap.delete(from)
  draft.streamLeaseMap.delete(from)
  if (ctrl) { draft.activeAbortControllers.set(to, ctrl) }
  if (run && (run.completedAtMs === null || !state.runDisplayMetaMap.has(to))) {
    draft.runDisplayMetaMap.set(to, { ...run } as Draft<ChatRunDisplayMeta>)
  }
  if (lease) {
    draft.streamLeaseMap.set(to, { ...lease } as Draft<MessageStreamLease>)
  }

  const runState = readSessionRunState(state, sessionId)
  if (readRunStateMessageId(runState) === from) {
    draft.runStateMap.set(sessionId, moveRunStateMessage(runState, to) as Draft<ChatRunState>)
  }
}

function moveStreamingRefs_immutable(state: ChatState, sessionId: string, from: string, to: string): Partial<ChatState> {
  const nextAbort = new Map(state.activeAbortControllers)
  const ctrl = nextAbort.get(from)
  nextAbort.delete(from)
  if (ctrl) { nextAbort.set(to, ctrl) }

  const nextRun = new Map(state.runDisplayMetaMap)
  const run = nextRun.get(from)
  nextRun.delete(from)
  if (run && (run.completedAtMs === null || !nextRun.has(to))) { nextRun.set(to, { ...run }) }

  const nextLease = new Map(state.streamLeaseMap)
  const lease = nextLease.get(from)
  nextLease.delete(from)
  if (lease) { nextLease.set(to, { ...lease }) }

  const runState = readSessionRunState(state, sessionId)
  const nextRunState = new Map(state.runStateMap)
  if (readRunStateMessageId(runState) === from) {
    nextRunState.set(sessionId, moveRunStateMessage(runState, to))
  }

  return { activeAbortControllers: nextAbort, runDisplayMetaMap: nextRun, streamLeaseMap: nextLease, runStateMap: nextRunState }
}

function migrateDisplaySplit(state: ChatState, messagesMap: Map<string, UIMessage[]>, from: string, to: string): Partial<ChatState> {
  const split = state.assistantDisplaySplitMap.get(from)
  if (!split) { return {} }

  const nextTailId = `${to}:steer-tail`
  const nextSplits = new Map(state.assistantDisplaySplitMap)
  nextSplits.delete(from)
  if (!nextSplits.has(to)) {
    nextSplits.set(to, { ...split, sourceMessageId: to, tailMessageId: nextTailId })
  }

  const result: Partial<ChatState> = { assistantDisplaySplitMap: nextSplits }

  // Find session containing tail message and update it
  for (const [sid, msgs] of messagesMap) {
    const tailIdx = msgs.findIndex(m => m.id === split.tailMessageId)
    if (tailIdx === -1) { continue }

    const nextMsgs = msgs.slice()
    nextMsgs[tailIdx] = { ...msgs[tailIdx], id: nextTailId }
    const nextMap = new Map(messagesMap)
    nextMap.set(sid, nextMsgs)
    result.messagesMap = nextMap

    // Migrate streaming refs for tail
    const ctrl = state.activeAbortControllers.get(split.tailMessageId)
    if (ctrl) { const a = new Map(state.activeAbortControllers); a.delete(split.tailMessageId); a.set(nextTailId, ctrl); result.activeAbortControllers = a }
    const rm = state.runDisplayMetaMap.get(split.tailMessageId)
    if (rm) { const r = new Map(state.runDisplayMetaMap); r.delete(split.tailMessageId); r.set(nextTailId, rm); result.runDisplayMetaMap = r }
    const lease = state.streamLeaseMap.get(split.tailMessageId)
    if (lease) { const l = new Map(state.streamLeaseMap); l.delete(split.tailMessageId); l.set(nextTailId, lease); result.streamLeaseMap = l }
    const runState = readSessionRunState(state, sid)
    if (readRunStateMessageId(runState) === split.tailMessageId) {
      const nextRunState = new Map(state.runStateMap)
      nextRunState.set(sid, moveRunStateMessage(runState, nextTailId))
      result.runStateMap = nextRunState
    }
    break
  }

  return result
}

function trimTrailingEmptyParts(parts: MessagePart[]): MessagePart[] {
  let end = parts.length
  while (end > 0 && isEmptyPart(parts[end - 1])) { end-- }
  return end === parts.length ? parts : parts.slice(0, end)
}

function isEmptyPart(part: MessagePart): boolean {
  if (part.type === 'text') { return !(part as { text: string }).text }
  if (part.type === 'reasoning') {
    const reasoningPart = part as { text?: string, reasoning?: string }
    return !(reasoningPart.text || reasoningPart.reasoning)
  }
  return false
}

function projectTailFromHead(sourceParts: MessagePart[], headParts: MessagePart[]): MessagePart[] {
  // The tail is everything after the head's content
  return sourceParts.slice(headParts.length)
}
