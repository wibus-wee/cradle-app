import { getDesktopServerGeneration } from './base-url'

interface DesktopServerFetchRequest {
  requestId: string
  generation: number
  method: string
  path: string
  headers: Array<[string, string]>
  body: Uint8Array | null
}

interface DesktopServerFetchResponseHead {
  requestId: string
  status: number
  statusText: string
  headers: Array<[string, string]>
  url: string
}

interface DesktopServerFetchCancelledResponse {
  requestId: string
  cancelled: true
}

type DesktopServerFetchOpenResponse
  = | DesktopServerFetchResponseHead
    | DesktopServerFetchCancelledResponse

interface DesktopServerFetchChunk {
  requestId: string
  bytes: Uint8Array
}

interface DesktopServerFetchTerminalEvent {
  requestId: string
}

interface DesktopServerFetchErrorEvent extends DesktopServerFetchTerminalEvent {
  message: string
}

interface DesktopServerFetchBridge {
  open: (request: DesktopServerFetchRequest) => Promise<DesktopServerFetchOpenResponse>
  credit: (requestId: string, credit: number) => void
  cancel: (requestId: string) => void
  onChunk: (handler: (event: DesktopServerFetchChunk) => void) => () => void
  onClosed: (handler: (event: DesktopServerFetchTerminalEvent) => void) => () => void
  onError: (handler: (event: DesktopServerFetchErrorEvent) => void) => () => void
}

interface PendingBody {
  controller: ReadableStreamDefaultController<Uint8Array> | null
  queued: Uint8Array[]
  terminal: 'open' | 'closed' | Error
  cleanupAbort: () => void
}

const pendingBodies = new Map<string, PendingBody>()
let activeBridge: DesktopServerFetchBridge | null = null
let unsubscribeBridge: (() => void) | null = null

export function isDesktopIpcFetchAvailable(): boolean {
  return !!window.cradle?.serverFetch
}

export async function desktopIpcFetch(request: Request): Promise<Response> {
  const bridge = requireBridge()
  const generation = getDesktopServerGeneration()
  if (generation === null) {
    throw new Error('Desktop Server fetch generation is unavailable.')
  }
  const requestId = crypto.randomUUID()
  const abort = () => {
    bridge.cancel(requestId)
    terminatePending(requestId, request.signal.reason instanceof Error
      ? request.signal.reason
      : new DOMException('The operation was aborted.', 'AbortError'))
  }
  const pending: PendingBody = {
    controller: null,
    queued: [],
    terminal: 'open',
    cleanupAbort: () => request.signal.removeEventListener('abort', abort),
  }
  pendingBodies.set(requestId, pending)
  if (request.signal.aborted) {
    pending.cleanupAbort()
    pendingBodies.delete(requestId)
    bridge.cancel(requestId)
    throw request.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
  }
  request.signal.addEventListener('abort', abort, { once: true })

  try {
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? null
      : new Uint8Array(await request.arrayBuffer())
    if (request.signal.aborted) {
      throw request.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
    }
    const head = await bridge.open({
      requestId,
      generation,
      method: request.method,
      path: `${new URL(request.url).pathname}${new URL(request.url).search}`,
      headers: [...request.headers.entries()],
      body,
    })

    if ('cancelled' in head) {
      throw request.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
    }

    const responseBody = request.method === 'HEAD' || [204, 205, 304].includes(head.status)
      ? null
      : new ReadableStream<Uint8Array>({
      start(controller) {
        pending.controller = controller
        flushPending(requestId, pending)
      },
      pull() {
        bridge.credit(requestId, 1)
      },
      cancel() {
        bridge.cancel(requestId)
        pending.cleanupAbort()
        pendingBodies.delete(requestId)
      },
    }, { highWaterMark: 0 })

    if (!responseBody) {
      pending.cleanupAbort()
      pendingBodies.delete(requestId)
      bridge.cancel(requestId)
    }

    return new Response(responseBody, {
      status: head.status,
      statusText: head.statusText,
      headers: head.headers,
    })
  }
  catch (error) {
    pending.cleanupAbort()
    pendingBodies.delete(requestId)
    bridge.cancel(requestId)
    throw error
  }
}

export function resetDesktopIpcFetchForTests(): void {
  unsubscribeBridge?.()
  unsubscribeBridge = null
  activeBridge = null
  for (const pending of pendingBodies.values()) {
    pending.cleanupAbort()
  }
  pendingBodies.clear()
}

function requireBridge(): DesktopServerFetchBridge {
  const bridge = window.cradle?.serverFetch
  if (!bridge) {
    throw new Error('Desktop Server fetch bridge is unavailable.')
  }
  if (activeBridge !== bridge) {
    unsubscribeBridge?.()
    activeBridge = bridge
    const unsubscribers = [
      bridge.onChunk(handleChunk),
      bridge.onClosed(event => terminatePending(event.requestId, 'closed')),
      bridge.onError(event => terminatePending(event.requestId, new Error(event.message))),
    ]
    unsubscribeBridge = () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }
  return bridge
}

function handleChunk(event: DesktopServerFetchChunk): void {
  const pending = pendingBodies.get(event.requestId)
  if (!pending || pending.terminal !== 'open') {
    return
  }
  if (pending.controller) {
    pending.controller.enqueue(event.bytes)
    return
  }
  pending.queued.push(event.bytes)
}

function terminatePending(requestId: string, terminal: 'closed' | Error): void {
  const pending = pendingBodies.get(requestId)
  if (!pending || pending.terminal !== 'open') {
    return
  }
  pending.terminal = terminal
  flushPending(requestId, pending)
}

function flushPending(requestId: string, pending: PendingBody): void {
  const controller = pending.controller
  if (!controller) {
    return
  }
  for (const chunk of pending.queued.splice(0)) {
    controller.enqueue(chunk)
  }
  if (pending.terminal === 'closed') {
    pending.cleanupAbort()
    pendingBodies.delete(requestId)
    controller.close()
  }
  else if (pending.terminal instanceof Error) {
    pending.cleanupAbort()
    pendingBodies.delete(requestId)
    controller.error(pending.terminal)
  }
}
