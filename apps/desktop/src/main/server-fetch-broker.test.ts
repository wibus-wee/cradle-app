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
})

describe('desktop server fetch broker', () => {
  it('injects Main credentials and advances a bounded response only with renderer credit', async () => {
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
    const sender = {
      id: 41,
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    }
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    }
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: candidate => candidate.id === sender.id,
      readAuthHeaders: () => ({ authorization: 'Bearer main-owned-token' }),
    })
    brokers.push(broker)
    broker.register(ipcMain as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    const request: DesktopServerFetchRequest = {
      requestId: 'request-1',
      generation: 1,
      method: 'POST',
      path: '/sessions?limit=2',
      headers: [
        ['authorization', 'Bearer renderer-token'],
        ['content-type', 'application/json'],
      ],
      body: new TextEncoder().encode('{"name":"ipc"}'),
    }
    const head = await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!({ sender }, request) as {
      status: number
      requestId: string
      headers: Array<[string, string]>
    }

    expect(head).toMatchObject({ status: 200, requestId: 'request-1' })
    expect(new Headers(head.headers).has('set-cookie')).toBe(false)
    expect(sender.send).not.toHaveBeenCalled()
    const [target, init] = fetchFn.mock.calls[0]!
    expect(target.toString()).toBe('http://127.0.0.1:21423/sessions?limit=2')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer main-owned-token')
    expect(init.redirect).toBe('error')

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!({ sender }, 'request-1', 1)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1))
    expect(sender.send.mock.calls[0]![0]).toBe(DESKTOP_SERVER_FETCH_CHUNK_CHANNEL)
    expect(sender.send.mock.calls[0]![1].bytes).toHaveLength(DESKTOP_SERVER_FETCH_CHUNK_BYTES)

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!({ sender }, 'request-1', 1)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(2))
    expect(sender.send.mock.calls[1]![1].bytes).toHaveLength(17)

    listeners.get(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL)!({ sender }, 'request-1', 1)
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
      readAuthHeaders: () => ({ authorization: 'Bearer main-owned-token' }),
    })
    brokers.push(broker)
    broker.register(ipcMain as never)
    broker.setServerUrl(`http://127.0.0.1:${address.port}`, 1)

    const opens = Array.from({ length: 21 }, (_, index) => {
      const sender = {
        id: index + 1,
        isDestroyed: () => false,
        once: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn(),
      }
      const request: DesktopServerFetchRequest = {
        requestId: `window-${index}`,
        generation: 1,
        method: 'GET',
        path: `/health?window=${index}`,
        headers: [],
        body: null,
      }
      return handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!({ sender }, request)
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
    const sender = {
      id: 73,
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    }
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
    }
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
      readAuthHeaders: () => ({ authorization: 'Bearer main-owned-token' }),
    })
    brokers.push(broker)
    broker.register(ipcMain as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    const opening = handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!({ sender }, {
      requestId: 'pending-headers',
      generation: 1,
      method: 'GET',
      path: '/slow-headers',
      headers: [],
      body: null,
    })
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce())
    listeners.get(DESKTOP_SERVER_FETCH_CANCEL_CHANNEL)!({ sender }, 'pending-headers')

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('fences stale generations and aborts pending headers when the Server changes', async () => {
    const fetchFn = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    const sender = {
      id: 84,
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    }
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
      readAuthHeaders: () => ({ authorization: 'Bearer main-owned-token' }),
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    await expect(handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!({ sender }, {
      requestId: 'stale',
      generation: 2,
      method: 'GET',
      path: '/health',
      headers: [],
      body: null,
    })).rejects.toThrow('generation is stale')

    const opening = handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!({ sender }, {
      requestId: 'generation-change',
      generation: 1,
      method: 'GET',
      path: '/slow-headers',
      headers: [],
      body: null,
    })
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce())
    broker.setServerUrl('http://127.0.0.1:21424', 2)

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(broker.diagnostics().activeRequests).toBe(0)
  })

  it('cancels every request owned by a destroyed renderer', async () => {
    const cancelled = vi.fn()
    const fetchFn = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: cancelled,
    })))
    let destroyed: (() => void) | undefined
    const sender = {
      id: 95,
      isDestroyed: () => false,
      once: vi.fn((_event: string, handler: () => void) => {
        destroyed = handler
      }),
      removeListener: vi.fn(),
      send: vi.fn(),
    }
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const broker = new DesktopServerFetchBroker({
      fetchFn: fetchFn as never,
      isAllowedSender: () => true,
      readAuthHeaders: () => ({ authorization: 'Bearer main-owned-token' }),
    })
    brokers.push(broker)
    broker.register({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as never)
    broker.setServerUrl('http://127.0.0.1:21423', 1)

    await handlers.get(DESKTOP_SERVER_FETCH_OPEN_CHANNEL)!({ sender }, {
      requestId: 'owned-request',
      generation: 1,
      method: 'GET',
      path: '/stream',
      headers: [['accept', 'text/event-stream']],
      body: null,
    })
    expect(broker.diagnostics()).toMatchObject({ activeRequests: 1, rendererCount: 1 })
    destroyed?.()

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
    expect(broker.diagnostics()).toMatchObject({ activeRequests: 0, rendererCount: 0 })
  })
})
