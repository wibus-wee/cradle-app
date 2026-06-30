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
  ChatState,
  MessagePart,
  PublicStatus,
} from './types'
import { DEFAULT_SESSION_META, EMPTY_MESSAGES } from './types'

enableMapSet()

// ── Store ────────────────────────────────────────────────────

export const useChatStore = createWithEqualityFn<ChatState>()(
  subscribeWithSelector(
    (set, get) => ({
      messagesMap: new Map(),
      hydratedSessionIds: new Set(),
      generatingMessageIds: new Set(),
      passiveStreamingMessageIds: new Set(),
      activeAbortControllers: new Map(),
      runDisplayMetaMap: new Map(),
      errorMap: new Map(),
      sessionMetaMap: new Map(),
      activeGoalMap: new Map(),
      assistantDisplaySplitMap: new Map(),

      // ── Messages ─────────────────────────────────────────

      setMessages: (sessionId, messages) => {
        set((state) => {
          const splits = hydrateDisplaySplits(messages, state.assistantDisplaySplitMap)
          const displayed = applyDisplaySplits(messages, splits)
          const current = state.messagesMap.get(sessionId)
          const next = current ? reconcileMessages(current, displayed) : displayed
          const splitsChanged = splits !== state.assistantDisplaySplitMap

          const currentIds = new Set((current ?? []).map(m => m.id))
          const nextIds = new Set(displayed.map(m => m.id))
          const removed = [...currentIds].filter(id => !nextIds.has(id))

          if (current === next && !splitsChanged && (removed.length === 0 || state.passiveStreamingMessageIds.size === 0)) {
            return state
          }

          return produce(state, (draft) => {
            draft.messagesMap.set(sessionId, next)
            if (splitsChanged) {
              draft.assistantDisplaySplitMap = splits as Draft<Map<string, AssistantDisplaySplit>>
            }
            const removedPassiveStreaming = removed.some(id => state.passiveStreamingMessageIds.has(id))
            for (const id of removed) {
              draft.passiveStreamingMessageIds.delete(id)
              draft.errorMap.delete(id)
            }
            const meta = draft.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
            if (
              removedPassiveStreaming
              && meta.passiveStatus === 'streaming'
              && !displayed.some(message => draft.passiveStreamingMessageIds.has(message.id))
            ) {
              draft.sessionMetaMap.set(sessionId, { ...meta, passiveStatus: 'idle' })
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

          const meta = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          const effectiveSourceId = sourceMessageId ?? findActiveAssistantId(
            messages,
state.generatingMessageIds,
state.passiveStreamingMessageIds,
meta.localDriverMessageId,
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
            const shouldKeepTail = state.generatingMessageIds.has(sourceMessage.id)
              || state.passiveStreamingMessageIds.has(sourceMessage.id)
              || meta.localDriverMessageId === sourceMessage.id

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
            draft.generatingMessageIds.delete(messageId)
            draft.passiveStreamingMessageIds.delete(messageId)
            draft.activeAbortControllers.delete(messageId)
            draft.runDisplayMetaMap.delete(messageId)
            draft.errorMap.delete(messageId)
            const m = draft.sessionMetaMap.get(sessionId)
            if (m?.localDriverMessageId === messageId) {
              m.locallyDriving = false
              m.localDriverMessageId = undefined
            }
          })
        })
      },

      // ── Streaming ────────────────────────────────────────

      startGeneration: (sessionId, messageId, controller) => {
        set((state) => {
          const nextError = new Map(state.errorMap)
          for (const m of state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES) { nextError.delete(m.id) }
          const nextGen = new Set(state.generatingMessageIds).add(messageId)
          const nextPassive = new Set(state.passiveStreamingMessageIds)
          nextPassive.delete(messageId)
          const nextAbort = new Map(state.activeAbortControllers)
          nextAbort.set(messageId, controller)
          const nextMeta = new Map(state.sessionMetaMap)
          nextMeta.set(sessionId, { ...(state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META), cancelling: false, locallyDriving: true, localDriverMessageId: messageId })
          return { errorMap: nextError, generatingMessageIds: nextGen, passiveStreamingMessageIds: nextPassive, activeAbortControllers: nextAbort, sessionMetaMap: nextMeta }
        })
      },

      finishGeneration: (messageId) => {
        set((state) => {
          const ids = getRunMessageIds(state, messageId)
          const nextGen = new Set(state.generatingMessageIds)
          const nextPassive = new Set(state.passiveStreamingMessageIds)
          const nextAbort = new Map(state.activeAbortControllers)
          const nextRun = new Map(state.runDisplayMetaMap)
          for (const id of ids) {
            nextGen.delete(id)
            nextPassive.delete(id)
            nextAbort.delete(id)
            const rm = nextRun.get(id)
            if (rm && rm.completedAtMs === null) { nextRun.set(id, { ...rm, completedAtMs: performance.now() }) }
          }
          const nextMeta = new Map(state.sessionMetaMap)
          for (const [sid, meta] of state.sessionMetaMap) {
            if (meta.localDriverMessageId && ids.includes(meta.localDriverMessageId)) {
              nextMeta.set(sid, { ...meta, cancelling: false, locallyDriving: false, localDriverMessageId: undefined })
            }
          }
          return { generatingMessageIds: nextGen, passiveStreamingMessageIds: nextPassive, activeAbortControllers: nextAbort, runDisplayMetaMap: nextRun, sessionMetaMap: nextMeta }
        })
      },

      failGeneration: (messageId, error) => {
        set((state) => {
          const ids = getRunMessageIds(state, messageId)
          const visibleId = ids.at(-1) ?? messageId
          const nextGen = new Set(state.generatingMessageIds)
          const nextPassive = new Set(state.passiveStreamingMessageIds)
          const nextAbort = new Map(state.activeAbortControllers)
          const nextRun = new Map(state.runDisplayMetaMap)
          for (const id of ids) {
            nextGen.delete(id)
            nextPassive.delete(id)
            nextAbort.delete(id)
            const rm = nextRun.get(id)
            if (rm && rm.completedAtMs === null) { nextRun.set(id, { ...rm, completedAtMs: performance.now() }) }
          }
          const nextError = new Map(state.errorMap)
          nextError.set(visibleId, { message: error, timestamp: Date.now() })
          const nextMeta = new Map(state.sessionMetaMap)
          for (const [sid, meta] of state.sessionMetaMap) {
            if (meta.localDriverMessageId && ids.includes(meta.localDriverMessageId)) {
              nextMeta.set(sid, { ...meta, cancelling: false, locallyDriving: false, localDriverMessageId: undefined })
            }
          }
          return { generatingMessageIds: nextGen, passiveStreamingMessageIds: nextPassive, activeAbortControllers: nextAbort, runDisplayMetaMap: nextRun, errorMap: nextError, sessionMetaMap: nextMeta }
        })
      },

      stopGeneration: (messageId, sessionId) => {
        const controller = get().activeAbortControllers.get(messageId)
        if (controller) { controller.abort() }
        get().finishGeneration(messageId)
        get().setSessionMeta(sessionId, { cancelling: true, locallyDriving: false, localDriverMessageId: undefined, passiveStatus: 'idle' })
      },

      moveStreamingMessage: (sessionId, from, to) => {
        if (from === to) { return }
        set(state => moveStreamingRefs_immutable(state, sessionId, from, to))
      },

      setPassiveStreamingMessageIds: (sessionId, messageIds) => {
        set((state) => {
          const sessionMsgIds = new Set((state.messagesMap.get(sessionId) ?? []).map(m => m.id))
          const next = new Set(state.passiveStreamingMessageIds)
          for (const id of sessionMsgIds) { next.delete(id) }
          for (const id of messageIds) {
            const displayMessageId = resolveStreamingDisplayMessageId(state, id)
            if (sessionMsgIds.has(displayMessageId) && !state.generatingMessageIds.has(displayMessageId)) { next.add(displayMessageId) }
          }
          const currentMeta = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          const nextPassiveStatus = readPassiveStatusFromRefs(
            currentMeta.passiveStatus,
            hasSetIntersection(sessionMsgIds, next),
          )
          const metaChanged = nextPassiveStatus !== currentMeta.passiveStatus
          if (setsEqual(next, state.passiveStreamingMessageIds) && !metaChanged) { return state }
          const result: Partial<ChatState> = { passiveStreamingMessageIds: next }
          if (metaChanged) {
            const nextMeta = new Map(state.sessionMetaMap)
            nextMeta.set(sessionId, { ...currentMeta, passiveStatus: nextPassiveStatus })
            result.sessionMetaMap = nextMeta
          }
          return result
        })
      },

      setPassiveStreamingMessage: (sessionId, messageId, streaming) => {
        set((state) => {
          const sessionMsgIds = new Set((state.messagesMap.get(sessionId) ?? []).map(m => m.id))
          const next = new Set(state.passiveStreamingMessageIds)
          for (const id of getRunMessageIds(state, messageId)) {
            next.delete(id)
          }
          const displayMessageId = resolveStreamingDisplayMessageId(state, messageId)
          if (streaming && sessionMsgIds.has(displayMessageId) && !state.generatingMessageIds.has(displayMessageId)) {
            next.add(displayMessageId)
          }
          const currentMeta = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          const nextPassiveStatus = readPassiveStatusFromRefs(
            currentMeta.passiveStatus,
            hasSetIntersection(sessionMsgIds, next),
          )
          const metaChanged = nextPassiveStatus !== currentMeta.passiveStatus
          if (setsEqual(next, state.passiveStreamingMessageIds) && !metaChanged) { return state }
          const result: Partial<ChatState> = { passiveStreamingMessageIds: next }
          if (metaChanged) {
            const nextMeta = new Map(state.sessionMetaMap)
            nextMeta.set(sessionId, { ...currentMeta, passiveStatus: nextPassiveStatus })
            result.sessionMetaMap = nextMeta
          }
          return result
        })
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
          next.set(displayMessageId, { runId: c?.runId ?? null, requestStartedAtMs, firstEventAtMs: c?.firstEventAtMs ?? null, firstContentAtMs: c?.firstContentAtMs ?? null, completedAtMs: null })
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
          if (c?.runId === runId && c.completedAtMs === null && !needsMigration) { return state }
          const next = new Map(state.runDisplayMetaMap)
          if (displayMessageId !== messageId) {
            next.delete(messageId)
          }
          next.set(displayMessageId, { runId, requestStartedAtMs: c?.requestStartedAtMs ?? performance.now(), firstEventAtMs: c?.firstEventAtMs ?? null, firstContentAtMs: c?.firstContentAtMs ?? null, completedAtMs: null })
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

      // ── Session Meta ─────────────────────────────────────

      setSessionMeta: (sessionId, meta) => {
        set((state) => {
          const next = new Map(state.sessionMetaMap)
          next.set(sessionId, { ...(state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META), ...meta })
          return { sessionMetaMap: next }
        })
      },

      setPassiveStatus: (sessionId, status) => {
        set((state) => {
          const current = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          if (current.passiveStatus === status) { return state }
          const next = new Map(state.sessionMetaMap)
          next.set(sessionId, { ...current, passiveStatus: status })
          return { sessionMetaMap: next }
        })
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
            draft.sessionMetaMap.delete(sessionId)
            draft.activeGoalMap.delete(sessionId)
            for (const id of removed) {
              draft.generatingMessageIds.delete(id)
              draft.passiveStreamingMessageIds.delete(id)
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

// ── Selectors ────────────────────────────────────────────────

const EMPTY_IDS: string[] = []
const idsCache = new WeakMap<UIMessage[], string[]>()

function cachedIds(messages: UIMessage[]): string[] {
  if (messages === EMPTY_MESSAGES) { return EMPTY_IDS }
  let ids = idsCache.get(messages)
  if (!ids) {
    ids = messages.map(m => m.id)
    idsCache.set(messages, ids)
  }
  return ids
}

function hasActiveRunDisplayMeta(state: ChatState, messageId: string): boolean {
  const meta = state.runDisplayMetaMap.get(messageId)
  return Boolean(meta?.runId && meta.completedAtMs === null)
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
    s.generatingMessageIds.has(messageId),

  isStreamingMessage: (messageId: string) => (s: ChatState) =>
    s.generatingMessageIds.has(messageId) || s.passiveStreamingMessageIds.has(messageId) || hasActiveRunDisplayMeta(s, messageId),

  isVisibleStreamingMessage: (sessionId: string, messageId: string) => (s: ChatState) => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    return s.generatingMessageIds.has(messageId)
      || s.passiveStreamingMessageIds.has(messageId)
      || meta.localDriverMessageId === messageId
      || hasActiveRunDisplayMeta(s, messageId)
  },

  isAnyGenerating: (s: ChatState) => s.generatingMessageIds.size > 0,

  isSessionGenerating: (sessionId: string) => (s: ChatState) => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    if (meta.locallyDriving) { return true }
    return (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).some(m =>
      s.generatingMessageIds.has(m.id) || hasActiveRunDisplayMeta(s, m.id),
    )
  },

  isSessionStreaming: (sessionId: string) => (s: ChatState) => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    return meta.locallyDriving
      || meta.passiveStatus === 'streaming'
      || (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).some(m => hasActiveRunDisplayMeta(s, m.id))
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

  sessionMeta: (sessionId: string) => (s: ChatState) =>
    s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META,

  activeGoal: (sessionId: string) => (s: ChatState) =>
    s.activeGoalMap.get(sessionId) ?? null,

  isSessionHydrated: (sessionId: string) => (s: ChatState) =>
    s.hydratedSessionIds.has(sessionId),

  visibleStatus: (sessionId: string) => (s: ChatState): PublicStatus => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    if (
      meta.locallyDriving
      || meta.passiveStatus === 'streaming'
      || (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).some(m => hasActiveRunDisplayMeta(s, m.id))
    ) {
      return 'streaming'
    }
    if (meta.cancelling) { return 'idle' }
    if (meta.passiveStatus === 'error') { return 'error' }
    const msgs = s.errorMap.size > 0 ? s.messagesMap.get(sessionId) : undefined
    if (msgs?.some(m => s.errorMap.has(m.id))) { return 'error' }
    return meta.passiveStatus
  },

  runDisplayMeta: (messageId: string) => (s: ChatState) =>
    s.runDisplayMetaMap.get(messageId),
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

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a === b) { return true }
  if (a.size !== b.size) { return false }
  for (const v of a) {
    if (!b.has(v)) { return false }
  }
  return true
}

function hasSetIntersection<T>(left: Set<T>, right: Set<T>): boolean {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left]
  for (const value of smaller) {
    if (larger.has(value)) { return true }
  }
  return false
}

function readPassiveStatusFromRefs(current: PublicStatus, hasPassiveStreamingRefs: boolean): PublicStatus {
  if (hasPassiveStreamingRefs) {
    return 'streaming'
  }
  return current === 'streaming' ? 'idle' : current
}

function moveStreamingRefs(
  draft: Draft<ChatState>,
  state: ChatState,
  sessionId: string,
  from: string,
  to: string,
): void {
  if (from === to) { return }
  const wasGen = state.generatingMessageIds.has(from)
  const wasPassive = state.passiveStreamingMessageIds.has(from)
  const ctrl = state.activeAbortControllers.get(from)
  const run = state.runDisplayMetaMap.get(from)

  draft.generatingMessageIds.delete(from)
  draft.passiveStreamingMessageIds.delete(from)
  draft.activeAbortControllers.delete(from)
  draft.runDisplayMetaMap.delete(from)
  if (wasGen) { draft.generatingMessageIds.add(to) }
  if (wasPassive) { draft.passiveStreamingMessageIds.add(to) }
  if (ctrl) { draft.activeAbortControllers.set(to, ctrl) }
  if (run && (run.completedAtMs === null || !state.runDisplayMetaMap.has(to))) {
    draft.runDisplayMetaMap.set(to, { ...run } as Draft<ChatRunDisplayMeta>)
  }

  const meta = draft.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
  if (meta.localDriverMessageId === from) {
    draft.sessionMetaMap.set(sessionId, { ...meta, localDriverMessageId: to })
  }
}

function moveStreamingRefs_immutable(state: ChatState, sessionId: string, from: string, to: string): Partial<ChatState> {
  const nextGen = new Set(state.generatingMessageIds)
  const wasGen = nextGen.delete(from)
  if (wasGen) { nextGen.add(to) }

  const nextPassive = new Set(state.passiveStreamingMessageIds)
  const wasPassive = nextPassive.delete(from)
  if (wasPassive) { nextPassive.add(to) }

  const nextAbort = new Map(state.activeAbortControllers)
  const ctrl = nextAbort.get(from)
  nextAbort.delete(from)
  if (ctrl) { nextAbort.set(to, ctrl) }

  const nextRun = new Map(state.runDisplayMetaMap)
  const run = nextRun.get(from)
  nextRun.delete(from)
  if (run && (run.completedAtMs === null || !nextRun.has(to))) { nextRun.set(to, { ...run }) }

  const meta = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
  const nextMeta = new Map(state.sessionMetaMap)
  if (meta.localDriverMessageId === from) {
    nextMeta.set(sessionId, { ...meta, localDriverMessageId: to })
  }

  return { generatingMessageIds: nextGen, passiveStreamingMessageIds: nextPassive, activeAbortControllers: nextAbort, runDisplayMetaMap: nextRun, sessionMetaMap: nextMeta }
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
    const nextGen = new Set(state.generatingMessageIds)
    if (nextGen.delete(split.tailMessageId)) { nextGen.add(nextTailId); result.generatingMessageIds = nextGen }
    const nextPassive = new Set(state.passiveStreamingMessageIds)
    if (nextPassive.delete(split.tailMessageId)) { nextPassive.add(nextTailId); result.passiveStreamingMessageIds = nextPassive }
    const ctrl = state.activeAbortControllers.get(split.tailMessageId)
    if (ctrl) { const a = new Map(state.activeAbortControllers); a.delete(split.tailMessageId); a.set(nextTailId, ctrl); result.activeAbortControllers = a }
    const rm = state.runDisplayMetaMap.get(split.tailMessageId)
    if (rm) { const r = new Map(state.runDisplayMetaMap); r.delete(split.tailMessageId); r.set(nextTailId, rm); result.runDisplayMetaMap = r }
    const meta = state.sessionMetaMap.get(sid) ?? DEFAULT_SESSION_META
    if (meta.localDriverMessageId === split.tailMessageId) {
      const nm = new Map(state.sessionMetaMap); nm.set(sid, { ...meta, localDriverMessageId: nextTailId }); result.sessionMetaMap = nm
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
  if (part.type === 'reasoning') { return !((part as any).text || (part as any).reasoning) }
  return false
}

function projectTailFromHead(sourceParts: MessagePart[], headParts: MessagePart[]): MessagePart[] {
  // The tail is everything after the head's content
  return sourceParts.slice(headParts.length)
}
