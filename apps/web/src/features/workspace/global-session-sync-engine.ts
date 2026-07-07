import type {
  ChatGlobalSessionTailEvent,
  ChatSessionTailEventType,
} from '@cradle/chat-runtime-contracts'

export interface GlobalSessionSyncEngineCallbacks {
  onSessionChanged: (event: ChatGlobalSessionTailEvent) => void
  onSnapshotRequired?: () => void
  onError?: (error: unknown) => void
}

export interface GlobalSessionEventSource {
  addEventListener: ((type: 'sessions', listener: (event: MessageEvent<string>) => void) => void) & ((type: 'error', listener: (event: Event) => void) => void)
  close: () => void
}

export type GlobalSessionEventSourceFactory = (url: string) => GlobalSessionEventSource

export interface GlobalSessionSyncEngineOptions {
  serverBaseUrl: string
  afterSequenceId?: number
  workspaceId?: string | null
  eventSourceFactory?: GlobalSessionEventSourceFactory
  callbacks: GlobalSessionSyncEngineCallbacks
}

const SESSION_SUMMARY_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'UserMessageAppended',
  'MessageImported',
  'AssistantMessageSnapshotted',
  'RunStarted',
  'InteractionRequested',
  'InteractionResolved',
  'PlanImplementationResponded',
  'RunCompleted',
  'RunFailed',
  'RunAborted',
  'QueueItemEnqueued',
  'QueueItemClaimed',
  'QueueItemReleased',
  'QueueItemFailed',
  'QueueItemReordered',
  'QueueItemUpdated',
  'QueueItemProviderTargetCleared',
  'QueueItemCancelled',
  'SteerApplied',
  'LastTurnRolledBack',
  'TitleChanged',
])

export class GlobalSessionSyncEngine {
  private readonly callbacks: GlobalSessionSyncEngineCallbacks
  private readonly eventSourceFactory: GlobalSessionEventSourceFactory
  private readonly url: string
  private lastSeenSequenceId: number
  private eventSource: GlobalSessionEventSource | null = null

  constructor(options: GlobalSessionSyncEngineOptions) {
    this.callbacks = options.callbacks
    this.eventSourceFactory = options.eventSourceFactory ?? createBrowserEventSource
    this.lastSeenSequenceId = options.afterSequenceId ?? 0
    this.url = buildGlobalSessionEventTailUrl({
      serverBaseUrl: options.serverBaseUrl,
      afterSequenceId: this.lastSeenSequenceId,
      workspaceId: options.workspaceId ?? null,
    })
  }

  start(): void {
    if (this.eventSource) {
      return
    }
    const eventSource = this.eventSourceFactory(this.url)
    eventSource.addEventListener('sessions', this.handleSessionEvent)
    eventSource.addEventListener('error', this.handleError)
    this.eventSource = eventSource
  }

  stop(): void {
    this.eventSource?.close()
    this.eventSource = null
  }

  getLastSeenSequenceId(): number {
    return this.lastSeenSequenceId
  }

  private readonly handleSessionEvent = (message: MessageEvent<string>): void => {
    const event = readGlobalSessionTailEvent(message.data)
    if (!event || event.sequenceId <= this.lastSeenSequenceId) {
      return
    }

    this.lastSeenSequenceId = event.sequenceId
    if (event.type === 'SnapshotRequired') {
      this.callbacks.onSnapshotRequired?.()
      return
    }
    if (SESSION_SUMMARY_EVENT_TYPES.has(event.type)) {
      this.callbacks.onSessionChanged(event)
    }
  }

  private readonly handleError = (event: Event): void => {
    this.callbacks.onError?.(event)
    this.callbacks.onSnapshotRequired?.()
  }
}

export function buildGlobalSessionEventTailUrl(input: {
  serverBaseUrl: string
  afterSequenceId: number
  workspaceId?: string | null
}): string {
  const url = new URL('/events', input.serverBaseUrl)
  url.searchParams.set('scope', 'sessions')
  url.searchParams.set('afterSequenceId', String(input.afterSequenceId))
  if (input.workspaceId) {
    url.searchParams.set('workspaceId', input.workspaceId)
  }
  return url.toString()
}

function createBrowserEventSource(url: string): GlobalSessionEventSource {
  return new EventSource(url)
}

function readGlobalSessionTailEvent(value: string): ChatGlobalSessionTailEvent | null {
  try {
    const parsed = JSON.parse(value) as Partial<ChatGlobalSessionTailEvent>
    if (
      parsed.scope !== 'sessions'
      || typeof parsed.sessionId !== 'string'
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
    return parsed as ChatGlobalSessionTailEvent
  }
 catch {
    return null
  }
}
