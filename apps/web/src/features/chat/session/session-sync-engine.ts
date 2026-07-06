import type {
  ChatSessionTailEvent,
  ChatSessionTailEventType,
} from '@cradle/chat-runtime-contracts'

import type {
  RuntimeSessionRunStatus,
  RuntimeSessionStatus,
} from '../commands/runtime-session-status-command'
import {
  deriveRuntimeActiveRunRefresh,
  deriveRuntimeQueueRefresh,
  deriveRuntimeTerminalRunRefresh,
  readTerminalRunReleaseCandidate,
} from './session-runtime-reconciliation'

export interface SessionSyncEngineCallbacks {
  onMessagesChanged: () => void
  onRuntimeStatusChanged: () => void
  onRuntimeUiSlotStatesChanged: () => void
  onQueueChanged: () => void
  onSessionSummaryChanged: () => void
  hasStreamLease?: (messageId: string) => boolean
  onSnapshotRequired?: () => void
  onError?: (error: unknown) => void
}

export interface SessionEventSource {
  addEventListener: ((type: 'session', listener: (event: MessageEvent<string>) => void) => void) & ((type: 'error', listener: (event: Event) => void) => void)
  close: () => void
}

export type SessionEventSourceFactory = (url: string) => SessionEventSource

export interface SessionPassiveStreamHandle {
  close: () => void
}

export interface SessionPassiveStreamRequest {
  sessionId: string
  messageId: string
  onSettled: () => void
}

export interface SessionPassiveStreamInput {
  enabled: boolean
  sessionId: string | null
  locallyDriven: boolean
  runtimeActiveRunMessageId: string | null
}

export type SessionPassiveStreamFactory = (request: SessionPassiveStreamRequest) => SessionPassiveStreamHandle

export interface SessionRuntimeReconciliationInput {
  runtimeStatus: RuntimeSessionStatus | null | undefined
  activeRun: RuntimeSessionRunStatus | null | undefined
  snapshotMessageIds: ReadonlySet<string>
  storeMessageIds: ReadonlySet<string>
}

export interface SessionRuntimeReconciliationAction {
  runDisplay: {
    messageId: string
    runId: string
  } | null
  requestSnapshotRefresh: boolean
  requestQueueRefresh: boolean
  terminalRunReleaseCandidate: RuntimeSessionRunStatus | null
}

export interface SessionSyncEngineOptions {
  sessionId: string
  serverBaseUrl: string
  afterVersion?: number
  eventSourceFactory?: SessionEventSourceFactory
  passiveStreamFactory?: SessionPassiveStreamFactory
  callbacks: SessionSyncEngineCallbacks
}

const MESSAGE_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'UserMessageAppended',
  'MessageImported',
  'AssistantMessageSnapshotted',
  'AssistantMessageCompleted',
  'PlanImplementationResponded',
  'SteerApplied',
  'LastTurnRolledBack',
])

const RUN_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'RunStarted',
  'RunCompleted',
  'RunFailed',
  'RunAborted',
])

const INTERACTION_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'InteractionRequested',
  'InteractionResolved',
])

const QUEUE_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'QueueItemEnqueued',
  'QueueItemClaimed',
  'QueueItemReleased',
  'QueueItemFailed',
  'QueueItemReordered',
  'QueueItemUpdated',
  'QueueItemProviderTargetCleared',
  'QueueItemCancelled',
])

export class SessionSyncEngine {
  private readonly sessionId: string
  private readonly callbacks: SessionSyncEngineCallbacks
  private readonly eventSourceFactory: SessionEventSourceFactory
  private readonly passiveStreamFactory: SessionPassiveStreamFactory | null
  private readonly url: string
  private lastSeenVersion: number
  private eventSource: SessionEventSource | null = null
  private passiveStream: {
    token: object
    sessionId: string
    messageId: string
    handle: SessionPassiveStreamHandle
  } | null = null

  private requestedRuntimeActiveRunMessageId: string | null = null
  private runtimeQueueSignature: string | null = null
  private latestTerminalRunRefreshId: string | null = null

  constructor(options: SessionSyncEngineOptions) {
    this.sessionId = options.sessionId
    this.callbacks = options.callbacks
    this.eventSourceFactory = options.eventSourceFactory ?? createBrowserEventSource
    this.passiveStreamFactory = options.passiveStreamFactory ?? null
    this.lastSeenVersion = options.afterVersion ?? 0
    this.url = buildSessionEventTailUrl({
      serverBaseUrl: options.serverBaseUrl,
      sessionId: options.sessionId,
      afterVersion: this.lastSeenVersion,
    })
  }

  start(): void {
    if (this.eventSource) {
      return
    }
    const eventSource = this.eventSourceFactory(this.url)
    eventSource.addEventListener('session', this.handleSessionEvent)
    eventSource.addEventListener('error', this.handleError)
    this.eventSource = eventSource
  }

  stop(): void {
    this.eventSource?.close()
    this.eventSource = null
    this.stopPassiveStream()
    this.resetRuntimeReconciliation()
  }

  getLastSeenVersion(): number {
    return this.lastSeenVersion
  }

  updatePassiveStream(input: SessionPassiveStreamInput): void {
    if (!input.enabled || !input.sessionId || input.locallyDriven || !input.runtimeActiveRunMessageId) {
      this.stopPassiveStream(input.sessionId)
      return
    }

    const messageId = input.runtimeActiveRunMessageId
    if (this.passiveStream?.sessionId === input.sessionId && this.passiveStream.messageId === messageId) {
      return
    }

    this.stopPassiveStream()
    this.startPassiveStream(input.sessionId, messageId)
  }

  reconcileRuntimeState(input: SessionRuntimeReconciliationInput): SessionRuntimeReconciliationAction {
    const activeRunMessageId = input.activeRun?.messageId ?? null
    const activeRunRefresh = deriveRuntimeActiveRunRefresh({
      activeRunMessageId,
      snapshotMessageIds: input.snapshotMessageIds,
      storeMessageIds: input.storeMessageIds,
      previousRequestedMessageId: this.requestedRuntimeActiveRunMessageId,
    })
    this.requestedRuntimeActiveRunMessageId = activeRunRefresh.nextRequestedMessageId

    const terminalRunRefresh = deriveRuntimeTerminalRunRefresh({
      runtimeStatus: input.runtimeStatus,
      snapshotMessageIds: input.snapshotMessageIds,
      storeMessageIds: input.storeMessageIds,
      previousRefreshRunId: this.latestTerminalRunRefreshId,
    })
    this.latestTerminalRunRefreshId = terminalRunRefresh.nextRefreshRunId

    const queueRefresh = deriveRuntimeQueueRefresh({
      runtimeStatus: input.runtimeStatus,
      previousSignature: this.runtimeQueueSignature,
    })
    this.runtimeQueueSignature = queueRefresh.nextSignature

    return {
      runDisplay: input.activeRun && input.activeRun.messageId
        ? {
            messageId: input.activeRun.messageId,
            runId: input.activeRun.runId,
          }
        : null,
      requestSnapshotRefresh: activeRunRefresh.requestSnapshotRefresh
        || terminalRunRefresh.requestSnapshotRefresh,
      requestQueueRefresh: queueRefresh.requestQueueRefresh,
      terminalRunReleaseCandidate: readTerminalRunReleaseCandidate(input.runtimeStatus),
    }
  }

  private resetRuntimeReconciliation(): void {
    this.requestedRuntimeActiveRunMessageId = null
    this.runtimeQueueSignature = null
    this.latestTerminalRunRefreshId = null
  }

  private readonly handleSessionEvent = (message: MessageEvent<string>): void => {
    const event = readChatSessionTailEvent(message.data, this.sessionId)
    if (!event || event.version <= this.lastSeenVersion) {
      return
    }

    this.lastSeenVersion = event.version
    this.applyEvent(event)
  }

  private readonly handleError = (event: Event): void => {
    this.callbacks.onError?.(event)
    this.requestSnapshotCatchup()
  }

  private startPassiveStream(sessionId: string, messageId: string): void {
    if (!this.passiveStreamFactory) {
      return
    }

    const token = {}
    const handle = this.passiveStreamFactory({
      sessionId,
      messageId,
      onSettled: () => {
        if (this.passiveStream?.token === token) {
          this.passiveStream = null
        }
      },
    })
    this.passiveStream = {
      token,
      sessionId,
      messageId,
      handle,
    }
  }

  private stopPassiveStream(sessionId?: string | null): void {
    const current = this.passiveStream
    if (!current || (sessionId && current.sessionId !== sessionId)) {
      return
    }
    this.passiveStream = null
    current.handle.close()
  }

  private applyEvent(event: ChatSessionTailEvent): void {
    if (event.type === 'SnapshotRequired') {
      this.callbacks.onSnapshotRequired?.()
      this.requestSnapshotCatchup()
      return
    }
    if (event.type === 'RunCompleted' || event.type === 'RunFailed' || event.type === 'RunAborted') {
      this.stopPassiveStream()
    }
    if (MESSAGE_EVENT_TYPES.has(event.type)) {
      if (!this.shouldSkipMessageSnapshotRefresh(event)) {
        this.callbacks.onMessagesChanged()
      }
      this.callbacks.onRuntimeUiSlotStatesChanged()
    }
    if (RUN_EVENT_TYPES.has(event.type)) {
      this.callbacks.onRuntimeStatusChanged()
      this.callbacks.onRuntimeUiSlotStatesChanged()
    }
    if (INTERACTION_EVENT_TYPES.has(event.type)) {
      this.callbacks.onRuntimeStatusChanged()
      this.callbacks.onRuntimeUiSlotStatesChanged()
    }
    if (QUEUE_EVENT_TYPES.has(event.type)) {
      this.callbacks.onQueueChanged()
      this.callbacks.onRuntimeStatusChanged()
    }
    if (event.type === 'TitleChanged' || event.type === 'RunCompleted' || event.type === 'RunFailed' || event.type === 'RunAborted') {
      this.callbacks.onSessionSummaryChanged()
    }
  }

  private requestSnapshotCatchup(): void {
    this.callbacks.onMessagesChanged()
    this.callbacks.onRuntimeStatusChanged()
    this.callbacks.onRuntimeUiSlotStatesChanged()
    this.callbacks.onQueueChanged()
    this.callbacks.onSessionSummaryChanged()
  }

  private shouldSkipMessageSnapshotRefresh(event: ChatSessionTailEvent): boolean {
    if (event.type !== 'AssistantMessageSnapshotted') {
      return false
    }
    const messageId = readTailMessageId(event)
    return Boolean(messageId && this.callbacks.hasStreamLease?.(messageId))
  }
}

export function buildSessionEventTailUrl(input: {
  serverBaseUrl: string
  sessionId: string
  afterVersion: number
}): string {
  const url = new URL(`/chat/sessions/${encodeURIComponent(input.sessionId)}/events`, input.serverBaseUrl)
  url.searchParams.set('afterVersion', String(input.afterVersion))
  return url.toString()
}

function createBrowserEventSource(url: string): SessionEventSource {
  return new EventSource(url)
}

function readChatSessionTailEvent(value: string, sessionId: string): ChatSessionTailEvent | null {
  try {
    const parsed = JSON.parse(value) as Partial<ChatSessionTailEvent>
    if (
      parsed.scope !== 'session'
      || parsed.sessionId !== sessionId
      || typeof parsed.sequenceId !== 'number'
      || typeof parsed.version !== 'number'
      || typeof parsed.type !== 'string'
      || typeof parsed.occurredAt !== 'number'
      || !parsed.payload
      || typeof parsed.payload !== 'object'
      || Array.isArray(parsed.payload)
    ) {
      return null
    }
    return parsed as ChatSessionTailEvent
  }
 catch {
    return null
  }
}

function readTailMessageId(event: ChatSessionTailEvent): string | null {
  const payload = event.payload as {
    messageId?: unknown
    message?: { id?: unknown }
  }
  if (typeof payload.messageId === 'string') {
    return payload.messageId
  }
  if (typeof payload.message?.id === 'string') {
    return payload.message.id
  }
  return null
}
