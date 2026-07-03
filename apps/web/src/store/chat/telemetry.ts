import type { UIMessage } from 'ai'

import type { ChatRunState, ChatState, PublicStatus } from './types'
import { DEFAULT_CHAT_RUN_STATE } from './types'

// ── Telemetry (diagnostic snapshot) ──────────────────────────

const TELEMETRY_SESSION_LIMIT = 20
const TELEMETRY_DEPTH_LIMIT = 6
const TELEMETRY_ENTRY_LIMIT = 200

interface SessionTelemetry {
  sessionId: string
  hydrated: boolean
  messageCount: number
  partCount: number
  textPartCount: number
  toolPartCount: number
  filePartCount: number
  dataPartCount: number
  reasoningPartCount: number
  estimatedPartStringChars: number
  streamingMessageCount: number
  generatingMessageCount: number
  passiveStreamingMessageCount: number
  hasLocalDriver: boolean
  passiveStatus: string
  errorCount: number
  activeGoal: boolean
  assistantDisplaySplitCount: number
}

interface ActiveStreamingMessage {
  sessionId: string
  messageId: string
  generating: boolean
  passiveStreaming: boolean
  localDriver: boolean
  runActive: boolean
  runId: string | null
  runCompletedAtMs: number | null | undefined
  role: string
  partCount: number
  estimatedPartStringChars: number
}

interface RunDisplayMetaMessage {
  sessionId: string | null
  messageId: string
  runId: string | null
  completedAtMs: number | null
  generating: boolean
  passiveStreaming: boolean
  localDriver: boolean
  role: string | null
  partCount: number
  splitSourceMessageId: string | null
  splitTailMessageId: string | null
}

export interface ChatStoreTelemetrySnapshot {
  totals: {
    sessionCount: number
    hydratedSessionCount: number
    messageCount: number
    partCount: number
    textPartCount: number
    toolPartCount: number
    filePartCount: number
    dataPartCount: number
    reasoningPartCount: number
    estimatedPartStringChars: number
    generatingMessageCount: number
    passiveStreamingMessageCount: number
    activeAbortControllerCount: number
    runDisplayMetaCount: number
    errorCount: number
    runStateCount: number
    activeGoalCount: number
    assistantDisplaySplitCount: number
  }
  sessions: SessionTelemetry[]
  limits: { sessionLimit: number, truncatedSessions: number }
  activeStreamingMessages: ActiveStreamingMessage[]
  runDisplayMetaMessages: RunDisplayMetaMessage[]
}

export function getChatStoreTelemetrySnapshot(state: ChatState): ChatStoreTelemetrySnapshot {
  const splitCounts = countSplitsBySession(state)
  const runStateCounts = countRunStates(state)
  const totals = {
    sessionCount: state.messagesMap.size,
    hydratedSessionCount: state.hydratedSessionIds.size,
    messageCount: 0,
    partCount: 0,
    textPartCount: 0,
    toolPartCount: 0,
    filePartCount: 0,
    dataPartCount: 0,
    reasoningPartCount: 0,
    estimatedPartStringChars: 0,
    generatingMessageCount: runStateCounts.local,
    passiveStreamingMessageCount: runStateCounts.passive,
    activeAbortControllerCount: state.activeAbortControllers.size,
    runDisplayMetaCount: state.runDisplayMetaMap.size,
    errorCount: state.errorMap.size,
    runStateCount: state.runStateMap.size,
    activeGoalCount: state.activeGoalMap.size,
    assistantDisplaySplitCount: state.assistantDisplaySplitMap.size,
  }

  const sessions: SessionTelemetry[] = []

  for (const [sessionId, messages] of state.messagesMap) {
    const runState = readSessionRunState(state, sessionId)
    const runProjection = projectRunStateTelemetry(runState)
    const session: SessionTelemetry = {
      sessionId,
      hydrated: state.hydratedSessionIds.has(sessionId),
      messageCount: messages.length,
      partCount: 0,
      textPartCount: 0,
      toolPartCount: 0,
      filePartCount: 0,
      dataPartCount: 0,
      reasoningPartCount: 0,
      estimatedPartStringChars: 0,
      streamingMessageCount: 0,
      generatingMessageCount: 0,
      passiveStreamingMessageCount: 0,
      hasLocalDriver: Boolean(runProjection.localDriverMessageId),
      passiveStatus: runProjection.passiveStatus,
      errorCount: 0,
      activeGoal: state.activeGoalMap.has(sessionId),
      assistantDisplaySplitCount: splitCounts.get(sessionId) ?? 0,
    }

    for (const message of messages) {
      if (state.errorMap.has(message.id)) { session.errorCount++ }
      const gen = isLocalStreamingMessage(state, message.id)
      const passive = isPassiveStreamingMessage(state, message.id)
      const runMeta = state.runDisplayMetaMap.get(message.id)
      const runActive = Boolean(runMeta?.runId && runMeta.completedAtMs === null)
      if (gen) { session.generatingMessageCount++ }
      if (passive) { session.passiveStreamingMessageCount++ }
      if (gen || passive || runProjection.localDriverMessageId === message.id || runActive) { session.streamingMessageCount++ }

      for (const part of message.parts) {
        session.partCount++
        session.estimatedPartStringChars += estimateChars(part)
        const t = (part as { type: string }).type
        if (t === 'text') { session.textPartCount++ }
        else if (t === 'file') { session.filePartCount++ }
        else if (t === 'reasoning' || t.startsWith('reasoning-')) { session.reasoningPartCount++ }
        else if (t.startsWith('tool-') || t === 'dynamic-tool') { session.toolPartCount++ }
        else if (t.startsWith('data-')) { session.dataPartCount++ }
      }
    }

    totals.messageCount += session.messageCount
    totals.partCount += session.partCount
    totals.textPartCount += session.textPartCount
    totals.toolPartCount += session.toolPartCount
    totals.filePartCount += session.filePartCount
    totals.dataPartCount += session.dataPartCount
    totals.reasoningPartCount += session.reasoningPartCount
    totals.estimatedPartStringChars += session.estimatedPartStringChars
    sessions.push(session)
  }

  sessions.sort((a, b) => b.estimatedPartStringChars - a.estimatedPartStringChars || b.messageCount - a.messageCount)

  return {
    totals,
    sessions: sessions.slice(0, TELEMETRY_SESSION_LIMIT),
    limits: { sessionLimit: TELEMETRY_SESSION_LIMIT, truncatedSessions: Math.max(0, sessions.length - TELEMETRY_SESSION_LIMIT) },
    activeStreamingMessages: getActiveStreaming(state),
    runDisplayMetaMessages: getRunDisplayMetaMessages(state),
  }
}

function getActiveStreaming(state: ChatState): ActiveStreamingMessage[] {
  const result: ActiveStreamingMessage[] = []
  for (const [sessionId, messages] of state.messagesMap) {
    const runState = readSessionRunState(state, sessionId)
    const runProjection = projectRunStateTelemetry(runState)
    for (const msg of messages) {
      const gen = isLocalStreamingMessage(state, msg.id)
      const passive = isPassiveStreamingMessage(state, msg.id)
      const local = runProjection.localDriverMessageId === msg.id
      const runMeta = state.runDisplayMetaMap.get(msg.id)
      const runActive = Boolean(runMeta?.runId && runMeta.completedAtMs === null)
      if (gen || passive || local || runActive) {
        result.push({
          sessionId,
          messageId: msg.id,
          generating: gen,
          passiveStreaming: passive,
          localDriver: local,
          runActive,
          runId: runMeta?.runId ?? null,
          runCompletedAtMs: runMeta?.completedAtMs,
          role: msg.role,
          partCount: msg.parts.length,
          estimatedPartStringChars: msg.parts.reduce((t, p) => t + estimateChars(p), 0),
        })
      }
    }
    if (runProjection.localDriverMessageId && !messages.some(m => m.id === runProjection.localDriverMessageId)) {
      const runMeta = state.runDisplayMetaMap.get(runProjection.localDriverMessageId)
      result.push({
        sessionId,
        messageId: runProjection.localDriverMessageId,
        generating: isLocalStreamingMessage(state, runProjection.localDriverMessageId),
        passiveStreaming: isPassiveStreamingMessage(state, runProjection.localDriverMessageId),
        localDriver: true,
        runActive: Boolean(runMeta?.runId && runMeta.completedAtMs === null),
        runId: runMeta?.runId ?? null,
        runCompletedAtMs: runMeta?.completedAtMs,
        role: 'unknown',
        partCount: 0,
        estimatedPartStringChars: 0,
      })
    }
  }
  return result
}

function getRunDisplayMetaMessages(state: ChatState): RunDisplayMetaMessage[] {
  const messageIndex = new Map<string, { sessionId: string, message: UIMessage }>()
  for (const [sessionId, messages] of state.messagesMap) {
    for (const message of messages) {
      messageIndex.set(message.id, { sessionId, message })
    }
  }

  const splitIndex = new Map<string, { sourceMessageId: string, tailMessageId: string }>()
  for (const split of state.assistantDisplaySplitMap.values()) {
    splitIndex.set(split.sourceMessageId, {
      sourceMessageId: split.sourceMessageId,
      tailMessageId: split.tailMessageId,
    })
    splitIndex.set(split.tailMessageId, {
      sourceMessageId: split.sourceMessageId,
      tailMessageId: split.tailMessageId,
    })
  }

  return [...state.runDisplayMetaMap.entries()]
    .slice(0, TELEMETRY_ENTRY_LIMIT)
    .map(([messageId, runMeta]) => {
      const indexed = messageIndex.get(messageId)
      const sessionId = indexed?.sessionId ?? null
      const runProjection = sessionId ? projectRunStateTelemetry(readSessionRunState(state, sessionId)) : projectRunStateTelemetry(DEFAULT_CHAT_RUN_STATE)
      const split = splitIndex.get(messageId)
      return {
        sessionId,
        messageId,
        runId: runMeta.runId,
        completedAtMs: runMeta.completedAtMs,
        generating: isLocalStreamingMessage(state, messageId),
        passiveStreaming: isPassiveStreamingMessage(state, messageId),
        localDriver: runProjection.localDriverMessageId === messageId,
        role: indexed?.message.role ?? null,
        partCount: indexed?.message.parts.length ?? 0,
        splitSourceMessageId: split?.sourceMessageId ?? null,
        splitTailMessageId: split?.tailMessageId ?? null,
      }
    })
}

function readSessionRunState(state: Pick<ChatState, 'runStateMap'>, sessionId: string): ChatRunState {
  return state.runStateMap.get(sessionId) ?? DEFAULT_CHAT_RUN_STATE
}

function projectRunStateTelemetry(runState: ChatRunState): {
  passiveStatus: PublicStatus
  localDriverMessageId?: string
} {
  if (runState.phase === 'streaming') {
    return {
      passiveStatus: 'streaming',
      localDriverMessageId: runState.source === 'local' ? runState.messageId : undefined,
    }
  }
  if (runState.phase === 'submitting') {
    return {
      passiveStatus: 'streaming',
      localDriverMessageId: runState.messageId,
    }
  }
  return {
    passiveStatus: runState.phase !== 'idle' && runState.error ? 'error' : 'idle',
    localDriverMessageId: undefined,
  }
}

function isLocalStreamingMessage(state: ChatState, messageId: string): boolean {
  return [...state.runStateMap.values()].some(runState =>
    runState.phase === 'streaming' && runState.source === 'local' && runState.messageId === messageId)
}

function isPassiveStreamingMessage(state: ChatState, messageId: string): boolean {
  return [...state.runStateMap.values()].some(runState =>
    runState.phase === 'streaming' && runState.source === 'passive' && runState.messageId === messageId)
}

function countRunStates(state: ChatState): { local: number, passive: number } {
  let local = 0
  let passive = 0
  for (const runState of state.runStateMap.values()) {
    if (runState.phase !== 'streaming') {
      continue
    }
    if (runState.source === 'local') {
      local++
    }
 else {
      passive++
    }
  }
  return { local, passive }
}

function countSplitsBySession(state: ChatState): Map<string, number> {
  const msgSession = new Map<string, string>()
  for (const [sid, msgs] of state.messagesMap) {
    for (const m of msgs) { msgSession.set(m.id, sid) }
  }
  const counts = new Map<string, number>()
  for (const split of state.assistantDisplaySplitMap.values()) {
    const sid = msgSession.get(split.sourceMessageId) ?? msgSession.get(split.tailMessageId)
    if (sid) { counts.set(sid, (counts.get(sid) ?? 0) + 1) }
  }
  return counts
}

function estimateChars(value: unknown, depth = 0, seen = new Set<object>()): number {
  if (typeof value === 'string') { return value.length }
  if (!value || typeof value !== 'object' || seen.has(value) || depth >= TELEMETRY_DEPTH_LIMIT) { return 0 }
  seen.add(value)
  let total = 0
  const entries = Array.isArray(value) ? value : Object.values(value)
  for (const item of entries.slice(0, TELEMETRY_ENTRY_LIMIT)) {
    total += estimateChars(item, depth + 1, seen)
  }
  seen.delete(value)
  return total
}
