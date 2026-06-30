import type { UIMessage } from 'ai'

// ── Public Types ─────────────────────────────────────────────

export type PublicStatus = 'idle' | 'streaming' | 'error'
export type MessagePart = UIMessage['parts'][number]

export interface ChatError {
  message: string
  timestamp: number
}

export interface ChatRunDisplayMeta {
  runId: string | null
  requestStartedAtMs: number
  firstEventAtMs: number | null
  firstContentAtMs: number | null
  completedAtMs: number | null
}

export type ChatActiveGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'

export interface ChatActiveGoal {
  sessionId: string
  objective: string
  status: ChatActiveGoalStatus
  sourceMessageId: string | null
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export interface SessionMeta {
  passiveStatus: PublicStatus
  locallyDriving: boolean
  cancelling: boolean
  localDriverMessageId?: string
}

export interface AssistantDisplaySplit {
  sourceMessageId: string
  tailMessageId: string
  splitParts: UIMessage['parts']
  insertedMessageIds: string[]
  insertedQueueItemIds: string[]
}

export interface MessageReconcileChange {
  dirtyToolCallIds?: ReadonlySet<string>
}

// ── State Interface ──────────────────────────────────────────

export interface ChatState {
  messagesMap: Map<string, UIMessage[]>
  hydratedSessionIds: Set<string>
  generatingMessageIds: Set<string>
  passiveStreamingMessageIds: Set<string>
  activeAbortControllers: Map<string, AbortController>
  runDisplayMetaMap: Map<string, ChatRunDisplayMeta>
  errorMap: Map<string, ChatError>
  sessionMetaMap: Map<string, SessionMeta>
  activeGoalMap: Map<string, ChatActiveGoal>
  assistantDisplaySplitMap: Map<string, AssistantDisplaySplit>

  // Messages
  setMessages: (sessionId: string, messages: UIMessage[]) => void
  updateMessage: (sessionId: string, messageId: string, updater: (msg: UIMessage) => UIMessage, change?: MessageReconcileChange) => void
  appendMessage: (sessionId: string, message: UIMessage) => void
  insertLiveSteerMessage: (sessionId: string, message: UIMessage, sourceMessageId?: string | null) => void
  removeMessage: (sessionId: string, messageId: string) => void

  // Streaming
  startGeneration: (sessionId: string, messageId: string, controller: AbortController) => void
  finishGeneration: (messageId: string) => void
  failGeneration: (messageId: string, error: string) => void
  stopGeneration: (messageId: string, sessionId: string) => void
  moveStreamingMessage: (sessionId: string, fromMessageId: string, toMessageId: string) => void
  setPassiveStreamingMessageIds: (sessionId: string, messageIds: string[]) => void
  setPassiveStreamingMessage: (sessionId: string, messageId: string, streaming: boolean) => void
  beginRunDisplayMeta: (messageId: string, requestStartedAtMs: number) => void
  setRunDisplayId: (messageId: string, runId: string) => void
  moveRunDisplayMeta: (fromMessageId: string, toMessageId: string) => void
  markRunFirstEvent: (messageId: string, timestampMs: number) => void
  markRunFirstContent: (messageId: string, timestampMs: number) => void
  projectStreamingMessageForDisplay: (sessionId: string, message: UIMessage) => UIMessage

  // Session Meta
  setSessionMeta: (sessionId: string, meta: Partial<SessionMeta>) => void
  setPassiveStatus: (sessionId: string, status: PublicStatus) => void
  setSessionHydrated: (sessionId: string, hydrated: boolean) => void
  setActiveGoal: (sessionId: string, input: {
    objective: string
    sourceMessageId?: string | null
    status?: ChatActiveGoalStatus
    tokenBudget?: number | null
  }) => void
  clearActiveGoal: (sessionId: string) => void

  // Cleanup
  clearSession: (sessionId: string) => void
  clearError: (messageId: string) => void
  clearSessionErrors: (sessionId: string) => void
}

// ── Constants ────────────────────────────────────────────────

export const EMPTY_MESSAGES: UIMessage[] = []
export const DEFAULT_SESSION_META: SessionMeta = { passiveStatus: 'idle', locallyDriving: false, cancelling: false }
