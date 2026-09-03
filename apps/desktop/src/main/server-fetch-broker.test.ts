import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesktopServerFetchRequest } from '../shared/server-fetch-transport'
import {
  DESKTOP_SERVER_FETCH_CANCEL_CHANNEL,
  DESKTOP_SERVER_FETCH_CHUNK_BYTES,
  DESKTOP_SERVER_FETCH_CHUNK_CHANNEL,
  DESKTOP_SERVER_FETCH_CLOSED_CHANNEL,
  DESKTOP_SERVER_FETCH_CREDIT_CHANNEL,
  DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
} from '../shared/server-fetch-transport'
import { DesktopServerFetchBroker } from './server-fetch-broker'

const brokers: DesktopServerFetchBroker[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(brokers.splice(0).map(broker => broker.close()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })))
  vi.restoreAllMocks()
  vi.useRealTimers()
})

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn()
  readonly mainFrame = { detached: false }
  private destroyed = false

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }

  navigate(options: { isMainFrame?: boolean, isSameDocument?: boolean } = {}): void {
    this.emit('did-start-navigation', {
      isMainFrame: options.isMainFrame ?? true,
      isSameDocument: options.isSameDocument ?? false,
      url: 'http://renderer.test/next',
      frame: null,
    })
  }

  crash(): void {
    this.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  }
}

function ipcEvent(sender: FakeWebContents) {
  return {
    sender,
    senderFrame: sender.mainFrame,
    frameId: 1,
    processId: 1,
    type: 'frame',
  }
}

describe('desktop server fetch broker', () => {
  it('strips renderer credentials and advances a bounded response only with renderer credit', async () => {
    const bytes = new Uint8Array(DESKTOP_SERVER_FETCH_CHUNK_BYTES + 17).fill(7)
    const fetchFn = vi.fn(async (_url: URL, _init: RequestInit) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'set-cookie': 'must-not-reach-renderer=true',
        },
      },
    ))
    const sender = new FakeWebContents(41)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    }
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: candidate => candidate.id === sender.id,
    })
    brokers.push(broker)
    broker.register(ipcMain as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    const request: DesktopServerFetchRequest = {
      requestId: 'request-1',
      generation: 1,
      documentId: 'document-1',
      method: 'POST',
      path: '/sessions?limit=2',
      headers: [
        ['authorization', 'Bearer renderer-token'],
        ['content-type', 'application/json'],
      ],
      body: new TextEncoder().encode('{"name":"ipc"}'),
    }
    const head = await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), request) as {
      status: number
      requestId: string
      headers: Array<[string, string]>
    }

    expect(head).toMatchObject({ status: 200, requestId: 'request-1' })
    expect(new Headers(head.headers).has('set-cookie')).toBe(false)
    expect(sender.send).not.toHaveBeenCalled()
    const [target, init] = fetchFn.mock.calls[0]!
    expect(target.toString()).toBe('http://127.0.0.1:21423/sessions?limit=2')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    expect(init.redirect).toBe('error')

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!(ipcEvent(sender), 'request-1', 1)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1))
    expect(sender.send.mock.calls[0]![0]).toBe(DESKTOP_SERVER_FETCH_CHUNK_CHANNEL)
    expect(sender.send.mock.calls[0]![1].bytes).toHaveLength(DESKTOP_SERVER_FETCH_CHUNK_BYTES)

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!(ipcEvent(sender), 'request-1', 1)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(2))
    expect(sender.send.mock.calls[1]![1].bytes).toHaveLength(17)

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!(ipcEvent(sender), 'request-1', 1)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(3))
    expect(sender.send.mock.calls[2]![0]).toBe(DESKTOP_SERVER_FETCH_CLOSED_CHANNEL)
  })

  it('opens twenty-one concurrent upstream requests outside the Chromium pool', async () => {
    const responses: ServerResponse[] = []
    let accepted = 0
    const server = createServer((_request, response) => {
      accepted += 1
      responses.push(response)
      if (responses.length === 21) {
        for (const pending of responses) {
          pending.writeHead(200, { 'content-type': 'application/json' })
          pending.end('{"ok":true}')
        }
      }
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo

    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    }
    const broker = new DesktopServerFetchBroker({
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register(ipcMain as never)
    broker.setServerUrl(`http://127.0.0.1:${address.port}`, 1)

    const opens = Array.from({ length: 21 }, (_, index) => {
      const sender = new FakeWebContents(index + 1)
      const request: DesktopServerFetchRequest = {
        requestId: `window-${index}`,
        generation: 1,
        documentId: `document-${index}`,
        method: 'GET',
        path: `/health?window=${index}`,
        headers: [],
        body: null,
      }
      return handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), request)
    })

    const heads = await Promise.all(opens)
    expect(accepted).toBe(21)
    expect(heads).toHaveLength(21)
    expect(heads.every(head => (head as { status: number }).status === 200)).toBe(true)
  }, 10_000)

  it('aborts an upstream request while response headers are pending', async () => {
    const fetchFn = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    const sender = new FakeWebContents(73)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    }
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register(ipcMain as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    const opening = handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'pending-headers',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/slow-headers',
      headers: [],
      body: null,
    })
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce())
    listeners.get(DESKTOP_SERVER_FETCH_CANCEL_CHANNEL)!(ipcEvent(sender), 'pending-headers')

    await expect(opening).resolves.toEqual({
      requestId: 'pending-headers',
      cancelled: true,
    })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('fences stale generations and aborts pending headers when the Server changes', async () => {
    const fetchFn = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    const sender = new FakeWebContents(84)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    await expect(handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'stale',
      generation: 2,
      documentId: 'document-1',
      method: 'GET',
      path: '/health',
      headers: [],
      body: null,
    })).rejects.toThrow('generation is stale')

    const opening = handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'generation-change',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/slow-headers',
      headers: [],
      body: null,
    })
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce())
    broker.setServerUrl('http://127.0.0.1:21424', 2)

    await expect(opening).resolves.toEqual({
      requestId: 'generation-change',
      cancelled: true,
    })
    expect(broker.diagnostics().activeRequests).toBe(0)
  })

  it('cancels every request owned by a destroyed renderer', async () => {
    const cancelled = vi.fn()
    const fetchFn = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: cancelled,
    })))
    const sender = new FakeWebContents(95)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'owned-request',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/stream',
      headers: [['accept', 'text/event-stream']],
      body: null,
    })
    expect(broker.diagnostics()).toMatchObject({ activeRequests: 1, rendererCount: 1 })
    sender.destroy()

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
    expect(broker.diagnostics()).toMatchObject({ activeRequests: 0, rendererCount: 0 })
  })

  it('cancels every old-document request on main-frame cross-document navigation', async () => {
    const cancelled = vi.fn()
    const fetchFn = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })))
    const sender = new FakeWebContents(101)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    await Promise.all(['finite', 'stream'].map((requestId, index) => handlers.get(
      DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
    )!(ipcEvent(sender), {
      requestId,
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: `/events/${requestId}`,
      headers: index === 1 ? [['accept', 'text/event-stream']] : [],
      body: null,
    })))
    expect(sender.listenerCount('did-start-navigation')).toBe(1)
    expect(sender.listenerCount('render-process-gone')).toBe(1)

    sender.navigate()

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(2))
    expect(broker.diagnostics()).toMatchObject({
      activeRequests: 0,
      rendererCount: 0,
      cancellations: { navigation: 2 },
    })
    expect(sender.listenerCount('did-start-navigation')).toBe(1)
    expect(sender.listenerCount('render-process-gone')).toBe(1)
    sender.destroy()
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
  })

  it('preserves requests across same-document and subframe navigation', async () => {
    const cancelled = vi.fn()
    const fetchFn = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })))
    const sender = new FakeWebContents(102)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({ fetchFn: fetchFn as never, isAllowedSender: () => true })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'route-request',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/events',
      headers: [['accept', 'text/event-stream']],
      body: null,
    })

    sender.navigate({ isSameDocument: true })
    sender.navigate({ isMainFrame: false })
    expect(broker.diagnostics().activeRequests).toBe(1)
    expect(cancelled).not.toHaveBeenCalled()

    listeners.get(DESKTOP_SERVER_FETCH_CANCEL_CHANNEL)!(ipcEvent(sender), 'route-request')
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
  })

  it('rejects a late open from the retired document and accepts the next document', async () => {
    const sender = new FakeWebContents(109)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: (async () => new Response(new ReadableStream<Uint8Array>())) as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'old-active',
      documentId: 'old-document',
      generation: 1,
      method: 'GET',
      path: '/events',
      headers: [],
      body: null,
    })
    sender.navigate()

    await expect(handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'old-late',
      documentId: 'old-document',
      generation: 1,
      method: 'GET',
      path: '/late',
      headers: [],
      body: null,
    })).resolves.toEqual({ requestId: 'old-late', cancelled: true })

    await expect(handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'new-document',
      documentId: 'new-document',
      generation: 1,
      method: 'GET',
      path: '/events',
      headers: [],
      body: null,
    })).resolves.toMatchObject({ requestId: 'new-document', status: 200 })
    expect(broker.diagnostics().requests[0]).toMatchObject({
      requestId: 'new-document',
      ownerGeneration: 2,
    })
  })

  it('cancels requests when the renderer process exits', async () => {
    const cancelled = vi.fn()
    const sender = new FakeWebContents(103)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: (async () => new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }))) as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'crashed-request',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/events',
      headers: [],
      body: null,
    })

    sender.crash()

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
    expect(broker.diagnostics()).toMatchObject({
      activeRequests: 0,
      cancellations: { 'render-process-gone': 1 },
    })
  })

  it('expires zero-credit bodies but preserves a quiet stream with outstanding credit', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    const sender = new FakeWebContents(104)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: (async () => new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }))) as never,
      isAllowedSender: () => true,
      consumerIdleMs: 1_000,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'idle-finite',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/large',
      headers: [],
      body: null,
    })
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'quiet-sse',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/events',
      headers: [['accept', 'text/event-stream']],
      body: null,
    })
    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!(ipcEvent(sender), 'quiet-sse', 1)

    await vi.advanceTimersByTimeAsync(1_001)

    expect(broker.diagnostics()).toMatchObject({
      activeRequests: 1,
      zeroCreditRequests: 0,
      cancellations: { 'consumer-idle': 1 },
    })
    expect(broker.diagnostics().requests[0]).toMatchObject({ requestId: 'quiet-sse', credit: 1 })
    listeners.get(DESKTOP_SERVER_FETCH_CANCEL_CHANNEL)!(ipcEvent(sender), 'quiet-sse')
    await vi.runAllTimersAsync()
  })

  it('resets the idle lease when credit resumes and restarts it after delivery', async () => {
    vi.useFakeTimers()
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const cancelled = vi.fn()
    const sender = new FakeWebContents(108)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: (async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
        },
        cancel: cancelled,
      }))) as never,
      isAllowedSender: () => true,
      consumerIdleMs: 1_000,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'lease-reset',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/events',
      headers: [['accept', 'text/event-stream']],
      body: null,
    })

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!(ipcEvent(sender), 'lease-reset', 1)
    streamController.enqueue(new Uint8Array([1]))
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(500)
    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!(ipcEvent(sender), 'lease-reset', 1)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(cancelled).not.toHaveBeenCalled()

    streamController.enqueue(new Uint8Array([2]))
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(1_001)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(broker.diagnostics().cancellations['consumer-idle']).toBe(1)
  })

  it('reports bounded payload-free request diagnostics', async () => {
    const sender = new FakeWebContents(105)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: (async () => new Response(new ReadableStream<Uint8Array>(), {
        headers: { 'content-length': '4096' },
      })) as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'diagnostic-request',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/chat/sessions/session-id/messages?limit=100&token=secret',
      headers: [['authorization', 'Bearer secret']],
      body: null,
    })

    const diagnostics = broker.diagnostics()
    expect(diagnostics).toMatchObject({
      activeRequests: 1,
      declaredUndeliveredBytes: 4096,
      bufferedBytes: 0,
    })
    expect(diagnostics.requests[0]).toMatchObject({
      pathname: '/chat/sessions/session-id/messages',
      declaredBytes: 4096,
      deliveredBytes: 0,
      state: 'waiting-credit',
    })
    expect(JSON.stringify(diagnostics)).not.toContain('token=secret')
    expect(JSON.stringify(diagnostics)).not.toContain('Bearer secret')
  })

  it('closes the real upstream socket when navigation abandons a response', async () => {
    let resolveClosed!: () => void
    const responseClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const server = createServer((_request, response) => {
      response.on('close', resolveClosed)
      response.writeHead(200, {
        'content-length': String(8 * 1024 * 1024),
        'content-type': 'application/octet-stream',
      })
      response.flushHeaders()
      response.write(Buffer.alloc(1024 * 1024, 7))
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const sender = new FakeWebContents(106)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({ isAllowedSender: () => true })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl(`http://127.0.0.1:${address.port}`, 1)
    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
      requestId: 'large-response',
      generation: 1,
      documentId: 'document-1',
      method: 'GET',
      path: '/large',
      headers: [],
      body: null,
    })

    sender.navigate()

    await Promise.race([
      responseClosed,
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error('upstream socket did not close after navigation')),
        1_000,
      )),
    ])
    expect(broker.diagnostics().activeRequests).toBe(0)
  })

  it('returns to zero retained requests after ten same-window reloads', async () => {
    const sender = new FakeWebContents(107)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: (async () => new Response(new ReadableStream<Uint8Array>())) as never,
      isAllowedSender: () => true,
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    for (let generation = 1; generation <= 10; generation += 1) {
      await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!(ipcEvent(sender), {
        requestId: `reload-${generation}`,
        generation: 1,
        documentId: `document-${generation}`,
        method: 'GET',
        path: '/events',
        headers: [['accept', 'text/event-stream']],
        body: null,
      })
      expect(broker.diagnostics().activeRequests).toBe(1)
      sender.navigate()
      expect(broker.diagnostics()).toMatchObject({ activeRequests: 0, rendererCount: 0 })
    }
    expect(broker.diagnostics().cancellations.navigation).toBe(10)
  })
})
