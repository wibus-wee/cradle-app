import type { GlobalSessionEventSource } from '~/features/workspace/global-session-sync-engine'
import type {
  DesktopChatEventTailBridge,
  DesktopChatEventTailClosedEvent,
  DesktopChatEventTailErrorEvent,
  DesktopChatEventTailEvent,
  DesktopChatSubscribeGlobalSessionEventsRequest,
  DesktopChatSubscribeSessionEventsRequest,
} from '~/lib/electron'
import { readDesktopChatEventTailBridge } from '~/lib/electron'

import type { SessionEventSource } from '../session/session-sync-engine'

interface DesktopEventTailSource {
  routeDesktopEvent: (event: BufferedDesktopEvent) => void
  close: () => void
}

type BufferedDesktopEvent
  = | { kind: 'event', event: DesktopChatEventTailEvent }
    | { kind: 'closed', event: DesktopChatEventTailClosedEvent }
    | { kind: 'error', event: DesktopChatEventTailErrorEvent }

const PENDING_DESKTOP_EVENT_TAIL_LIMIT = 32
const PENDING_DESKTOP_EVENTS_PER_TAIL = 512

let desktopEventTailSubscriptions: Array<() => void> | null = null
const desktopEventTailSources = new Map<string, DesktopEventTailSource>()
const pendingDesktopEventTailEvents = new Map<string, BufferedDesktopEvent[]>()

export function createChatSessionEventSource(url: string): SessionEventSource {
  const bridge = readDesktopChatEventTailBridge()
  const request = readDesktopSessionEventTailRequest(url)
  if (!bridge || !request) {
    return new EventSource(url)
  }
  return new DesktopChatSessionEventSource(bridge, request)
}

export function createGlobalSessionEventSource(url: string): GlobalSessionEventSource {
  const bridge = readDesktopChatEventTailBridge()
  const request = readDesktopGlobalSessionEventTailRequest(url)
  if (!bridge || !request) {
    return new EventSource(url)
  }
  return new DesktopGlobalSessionEventSource(bridge, request)
}

class DesktopChatSessionEventSource implements SessionEventSource {
  private readonly bridge: DesktopChatEventTailBridge
  private readonly request: DesktopChatSubscribeSessionEventsRequest
  private readonly sessionListeners = new Set<(event: MessageEvent<string>) => void>()
  private readonly errorListeners = new Set<(event: Event) => void>()
  private tailId: string | null = null
  private closed = false

  constructor(
    bridge: DesktopChatEventTailBridge,
    request: DesktopChatSubscribeSessionEventsRequest,
  ) {
    this.bridge = bridge
    this.request = request
    activateDesktopEventTailBridge(bridge)
    queueMicrotask(() => {
      void this.open()
    })
  }

  addEventListener(type: 'session', listener: (event: MessageEvent<string>) => void): void
  addEventListener(type: 'error', listener: (event: Event) => void): void
  addEventListener(type: 'session' | 'error', listener: ((event: MessageEvent<string>) => void) | ((event: Event) => void)): void {
    if (type === 'session') {
      this.sessionListeners.add(listener as (event: MessageEvent<string>) => void)
      return
    }
    this.errorListeners.add(listener as (event: Event) => void)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (!this.tailId) {
      return
    }
    desktopEventTailSources.delete(this.tailId)
    pendingDesktopEventTailEvents.delete(this.tailId)
    void this.bridge.abort({ tailId: this.tailId })
  }

  routeDesktopEvent(event: BufferedDesktopEvent): void {
    if (this.closed) {
      return
    }
    if (event.kind === 'event') {
      this.dispatchSessionEvent(event.event.event)
      return
    }
    this.closed = true
    if (this.tailId) {
      desktopEventTailSources.delete(this.tailId)
      pendingDesktopEventTailEvents.delete(this.tailId)
    }
    this.dispatchErrorEvent()
  }

  private async open(): Promise<void> {
    try {
      const handle = await this.bridge.subscribeSessionEvents(this.request)
      if (this.closed) {
        void this.bridge.abort({ tailId: handle.tailId })
        return
      }
      this.tailId = handle.tailId
      desktopEventTailSources.set(handle.tailId, this)
      replayPendingDesktopEventTailEvents(handle.tailId)
    }
    catch {
      this.dispatchErrorEvent()
    }
  }

  private dispatchSessionEvent(event: unknown): void {
    const message = new MessageEvent('session', { data: JSON.stringify(event) })
    for (const listener of this.sessionListeners) {
      listener(message)
    }
  }

  private dispatchErrorEvent(): void {
    const event = new Event('error')
    for (const listener of this.errorListeners) {
      listener(event)
    }
  }
}

class DesktopGlobalSessionEventSource implements GlobalSessionEventSource {
  private readonly bridge: DesktopChatEventTailBridge
  private readonly request: DesktopChatSubscribeGlobalSessionEventsRequest
  private readonly sessionListeners = new Set<(event: MessageEvent<string>) => void>()
  private readonly errorListeners = new Set<(event: Event) => void>()
  private tailId: string | null = null
  private closed = false

  constructor(
    bridge: DesktopChatEventTailBridge,
    request: DesktopChatSubscribeGlobalSessionEventsRequest,
  ) {
    this.bridge = bridge
    this.request = request
    activateDesktopEventTailBridge(bridge)
    queueMicrotask(() => {
      void this.open()
    })
  }

  addEventListener(type: 'sessions', listener: (event: MessageEvent<string>) => void): void
  addEventListener(type: 'error', listener: (event: Event) => void): void
  addEventListener(type: 'sessions' | 'error', listener: ((event: MessageEvent<string>) => void) | ((event: Event) => void)): void {
    if (type === 'sessions') {
      this.sessionListeners.add(listener as (event: MessageEvent<string>) => void)
      return
    }
    this.errorListeners.add(listener as (event: Event) => void)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (!this.tailId) {
      return
    }
    desktopEventTailSources.delete(this.tailId)
    pendingDesktopEventTailEvents.delete(this.tailId)
    void this.bridge.abort({ tailId: this.tailId })
  }

  routeDesktopEvent(event: BufferedDesktopEvent): void {
    if (this.closed) {
      return
    }
    if (event.kind === 'event') {
      this.dispatchSessionEvent(event.event.event)
      return
    }
    this.closed = true
    if (this.tailId) {
      desktopEventTailSources.delete(this.tailId)
      pendingDesktopEventTailEvents.delete(this.tailId)
    }
    this.dispatchErrorEvent()
  }

  private async open(): Promise<void> {
    try {
      const handle = await this.bridge.subscribeGlobalSessionEvents(this.request)
      if (this.closed) {
        void this.bridge.abort({ tailId: handle.tailId })
        return
      }
      this.tailId = handle.tailId
      desktopEventTailSources.set(handle.tailId, this)
      replayPendingDesktopEventTailEvents(handle.tailId)
    }
    catch {
      this.dispatchErrorEvent()
    }
  }

  private dispatchSessionEvent(event: unknown): void {
    const message = new MessageEvent('sessions', { data: JSON.stringify(event) })
    for (const listener of this.sessionListeners) {
      listener(message)
    }
  }

  private dispatchErrorEvent(): void {
    const event = new Event('error')
    for (const listener of this.errorListeners) {
      listener(event)
    }
  }
}

function activateDesktopEventTailBridge(bridge: DesktopChatEventTailBridge): void {
  if (desktopEventTailSubscriptions) {
    return
  }
  desktopEventTailSubscriptions = [
    bridge.onEvent(event => routeDesktopEventTailEvent({ kind: 'event', event })),
    bridge.onClosed(event => routeDesktopEventTailEvent({ kind: 'closed', event })),
    bridge.onError(event => routeDesktopEventTailEvent({ kind: 'error', event })),
  ]
}

function routeDesktopEventTailEvent(event: BufferedDesktopEvent): void {
  const tailId = readDesktopEventTailId(event)
  const source = desktopEventTailSources.get(tailId)
  if (!source) {
    bufferPendingDesktopEventTailEvent(tailId, event)
    return
  }
  source.routeDesktopEvent(event)
}

function replayPendingDesktopEventTailEvents(tailId: string): void {
  const events = pendingDesktopEventTailEvents.get(tailId)
  if (!events) {
    return
  }
  pendingDesktopEventTailEvents.delete(tailId)
  for (const event of events) {
    routeDesktopEventTailEvent(event)
  }
}

function bufferPendingDesktopEventTailEvent(tailId: string, event: BufferedDesktopEvent): void {
  const pending = pendingDesktopEventTailEvents.get(tailId) ?? []
  pending.push(event)
  if (pending.length > PENDING_DESKTOP_EVENTS_PER_TAIL) {
    pending.splice(0, pending.length - PENDING_DESKTOP_EVENTS_PER_TAIL)
  }
  pendingDesktopEventTailEvents.delete(tailId)
  pendingDesktopEventTailEvents.set(tailId, pending)
  trimPendingDesktopEventTails()
}

function trimPendingDesktopEventTails(): void {
  while (pendingDesktopEventTailEvents.size > PENDING_DESKTOP_EVENT_TAIL_LIMIT) {
    const oldestTailId = pendingDesktopEventTailEvents.keys().next().value
    if (typeof oldestTailId !== 'string') {
      return
    }
    pendingDesktopEventTailEvents.delete(oldestTailId)
  }
}

function readDesktopEventTailId(event: BufferedDesktopEvent): string {
  return event.event.tailId
}

function readDesktopSessionEventTailRequest(url: string): DesktopChatSubscribeSessionEventsRequest | null {
  try {
    const parsed = new URL(url)
    const match = /^\/chat\/sessions\/([^/]+)\/events$/.exec(parsed.pathname)
    if (!match?.[1]) {
      return null
    }
    return {
      sessionId: decodeURIComponent(match[1]),
      afterVersion: readAfterVersion(parsed.searchParams.get('afterVersion')),
    }
  }
  catch {
    return null
  }
}

function readDesktopGlobalSessionEventTailRequest(
  url: string,
): DesktopChatSubscribeGlobalSessionEventsRequest | null {
  try {
    const parsed = new URL(url)
    if (parsed.pathname !== '/events' || parsed.searchParams.get('scope') !== 'sessions') {
      return null
    }
    return {
      afterSequenceId: readAfterVersion(parsed.searchParams.get('afterSequenceId')),
      workspaceId: parsed.searchParams.get('workspaceId')?.trim() || null,
    }
  }
  catch {
    return null
  }
}

function readAfterVersion(value: string | null): number {
  if (value === null) {
    return 0
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.floor(parsed))
}

export function disposeChatEventTailTransport(): void {
  if (desktopEventTailSubscriptions) {
    for (const unsubscribe of desktopEventTailSubscriptions) {
      unsubscribe()
    }
    desktopEventTailSubscriptions = null
  }
  for (const source of desktopEventTailSources.values()) {
    source.close()
  }
  desktopEventTailSources.clear()
  pendingDesktopEventTailEvents.clear()
}
