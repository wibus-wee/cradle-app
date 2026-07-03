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

export type ChatRunState
  = | { phase: 'idle', error: boolean }
    | { phase: 'submitting', messageId: string }
    | { phase: 'streaming', messageId: string, source: 'local' | 'passive' }
    | { phase: 'settling', messageId: string | null, cancelling: boolean, error: boolean }

export interface PassiveRunStateInput {
  messageIds: string[]
  status: PublicStatus
  allowMissingMessage?: boolean
  cancelling?: boolean
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
  runStateMap: Map<string, ChatRunState>
  activeAbortControllers: Map<string, AbortController>
  runDisplayMetaMap: Map<string, ChatRunDisplayMeta>
  errorMap: Map<string, ChatError>
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
  setRunCancelling: (sessionId: string, cancelling: boolean) => void
  moveStreamingMessage: (sessionId: string, fromMessageId: string, toMessageId: string) => void
  setPassiveRunState: (sessionId: string, input: PassiveRunStateInput) => void
  beginRunDisplayMeta: (messageId: string, requestStartedAtMs: number) => void
  setRunDisplayId: (messageId: string, runId: string) => void
  moveRunDisplayMeta: (fromMessageId: string, toMessageId: string) => void
  markRunFirstEvent: (messageId: string, timestampMs: number) => void
  markRunFirstContent: (messageId: string, timestampMs: number) => void
  projectStreamingMessageForDisplay: (sessionId: string, message: UIMessage) => UIMessage

  // Session lifecycle
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
export const DEFAULT_CHAT_RUN_STATE: ChatRunState = { phase: 'idle', error: false }
