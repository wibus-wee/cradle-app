import { describe, expect, it, vi } from 'vitest'

import type { CodexAppServerClientLike } from '../types'
import type { CodexAppServerMessage, CodexAppServerServerRequest } from './client'
import {
  addCodexAppServerHostRequestHandler,
  createCodexAppServerHostResource,
  createCodexAppServerLeaseClient,
  dispatchCodexAppServerHostRequest,
  disposeCodexAppServerHostResource,
} from './host-resource'

class FakeHostClient implements CodexAppServerClientLike {
  readonly pid = null
  readonly initialize = vi.fn(async () => undefined)
  readonly close = vi.fn(() => {
    this.waiter?.(null)
    this.waiter = null
  })

  private readonly notifications: CodexAppServerMessage[] = []
  private waiter: ((message: CodexAppServerMessage | null) => void) | null = null

  async request(method: string, params?: unknown): Promise<unknown> {
    if (method === 'thread/start' || method === 'thread/resume') {
      const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-a'
      return { thread: { id: threadId } }
    }
    return {}
  }

  async nextNotification(signal?: AbortSignal): Promise<CodexAppServerMessage | null> {
    const message = this.notifications.shift()
    if (message) {
      return message
    }
    return await new Promise((resolve) => {
      const onAbort = () => resolve(null)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiter = (next) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(next)
      }
    })
  }

  push(message: CodexAppServerMessage): void {
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(message)
      return
    }
    this.notifications.push(message)
  }
}

function createResource(fake: FakeHostClient) {
  return createCodexAppServerHostResource({
    clientOptions: {},
    createClient: () => fake,
  })
}

function notification(threadId: string, delta: string): CodexAppServerMessage {
  return {
    method: 'item/agentMessage/delta',
    params: { threadId, turnId: 'turn-1', itemId: 'item-1', delta },
  }
}

describe('codex provider app-server host routing', () => {
  it('buffers early notifications until thread binding and keeps concurrent threads isolated', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    let firstThreadId: string | null = null
    const first = createCodexAppServerLeaseClient(resource, () => firstThreadId)
    const second = createCodexAppServerLeaseClient(resource, () => 'thread-b')

    fake.push(notification('thread-a', 'first'))
    fake.push(notification('thread-b', 'second'))

    await expect(second.nextNotification()).resolves.toMatchObject({
      params: { threadId: 'thread-b', delta: 'second' },
    })

    const firstResult = (await first.request('thread/start', {})) as { thread: { id: string } }
    firstThreadId = firstResult.thread.id
    await expect(first.nextNotification()).resolves.toMatchObject({
      params: { threadId: 'thread-a', delta: 'first' },
    })

    await disposeCodexAppServerHostResource(resource)
  })

  it('keeps the host pump alive between leases and delivers buffered notifications to the next lease', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    const first = createCodexAppServerLeaseClient(resource, () => 'thread-a')
    await first.close()

    fake.push(notification('thread-a', 'while-idle'))
    await vi.waitFor(() => {
      expect(resource.pendingNotificationsByThreadId.get('thread-a')).toHaveLength(1)
    })

    const second = createCodexAppServerLeaseClient(resource, () => 'thread-a')
    await expect(second.nextNotification()).resolves.toMatchObject({
      params: { threadId: 'thread-a', delta: 'while-idle' },
    })

    await disposeCodexAppServerHostResource(resource)
  })

  it('dispatches thread-scoped server requests only to the exact owner', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    const first = vi.fn(async () => 'first')
    const second = vi.fn(async () => 'second')
    addCodexAppServerHostRequestHandler(
      resource,
      Object.assign(first, { readThreadId: () => 'thread-a' }),
    )
    addCodexAppServerHostRequestHandler(
      resource,
      Object.assign(second, { readThreadId: () => 'thread-b' }),
    )

    const request = {
      id: 1,
      method: 'item/tool/requestUserInput',
      params: { threadId: 'thread-b' },
    } as CodexAppServerServerRequest
    await expect(dispatchCodexAppServerHostRequest(resource, request)).resolves.toBe('second')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()

    await expect(
      dispatchCodexAppServerHostRequest(resource, {
        ...request,
        params: { threadId: 'thread-c' },
      }),
    ).rejects.toThrow('has no handler')

    await disposeCodexAppServerHostResource(resource)
  })
})
