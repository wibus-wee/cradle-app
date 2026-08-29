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
  threadStartResponse: Promise<unknown> | null = null

  get bufferedNotificationCount(): number {
    return this.notifications.length
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (method === 'thread/start' || method === 'thread/resume') {
      if (method === 'thread/start' && this.threadStartResponse) {
        return await this.threadStartResponse
      }
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
  it('holds one early notification until thread binding and keeps concurrent threads isolated', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    let firstThreadId: string | null = null
    const first = createCodexAppServerLeaseClient(resource, () => firstThreadId)
    const second = createCodexAppServerLeaseClient(resource, () => 'thread-b')
    let resolveThreadStart!: (value: unknown) => void
    fake.threadStartResponse = new Promise((resolve) => {
      resolveThreadStart = resolve
    })
    const firstRequest = first.request('thread/start', {})
    const firstNotification = first.nextNotification()
    const secondNotification = second.nextNotification()

    fake.push(notification('thread-a', 'first'))
    fake.push(notification('thread-b', 'second'))
    resolveThreadStart({ thread: { id: 'thread-a' } })
    const firstResult = (await firstRequest) as { thread: { id: string } }
    firstThreadId = firstResult.thread.id
    await expect(firstNotification).resolves.toMatchObject({
      params: { threadId: 'thread-a', delta: 'first' },
    })
    first.nextNotification()
    await expect(secondNotification).resolves.toMatchObject({
      params: { threadId: 'thread-b', delta: 'second' },
    })

    await disposeCodexAppServerHostResource(resource)
  })

  it('does not subscribe request-only leases or replay idle events into a future operation', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    const first = createCodexAppServerLeaseClient(resource, () => 'thread-a')
    await first.request('config/read')

    expect(resource.notificationSubscribers).toHaveLength(0)
    expect(resource.notificationPump).toBeInstanceOf(Promise)
    await first.close()
    resource.loadedThreadIds.add('thread-a')

    fake.push(notification('thread-a', 'while-idle'))
    await vi.waitFor(() => {
      expect(resource.discardedNotificationCount).toBe(1)
    })
    const second = createCodexAppServerLeaseClient(resource, () => 'thread-a')
    const next = second.nextNotification()
    fake.push(notification('thread-a', 'current-operation'))

    await expect(next).resolves.toMatchObject({
      params: { threadId: 'thread-a', delta: 'current-operation' },
    })

    await second.close()
    expect(resource.notificationOwnershipWaiters.size).toBe(0)

    await disposeCodexAppServerHostResource(resource)
  })

  it('pulls at most one notification ahead of a slow operation consumer', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    const client = createCodexAppServerLeaseClient(resource, () => 'thread-a')

    const first = client.nextNotification()
    fake.push(notification('thread-a', 'first'))
    await expect(first).resolves.toMatchObject({ params: { delta: 'first' } })

    fake.push(notification('thread-a', 'second'))
    fake.push(notification('thread-a', 'third'))
    expect(fake.bufferedNotificationCount).toBe(2)

    const second = client.nextNotification()
    await expect(second).resolves.toMatchObject({ params: { delta: 'second' } })
    expect(fake.bufferedNotificationCount).toBe(1)

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

    await expect(
      dispatchCodexAppServerHostRequest(resource, {
        ...request,
        params: {},
      }),
    ).rejects.toThrow('cannot route server request without an exact thread owner')

    await disposeCodexAppServerHostResource(resource)
  })

  it('prefers the active interactive owner over passive handlers for the same thread', async () => {
    const fake = new FakeHostClient()
    const resource = createResource(fake)
    const passive = vi.fn(async () => 'passive')
    const interactive = vi.fn(async () => 'interactive')
    addCodexAppServerHostRequestHandler(
      resource,
      Object.assign(passive, { readThreadId: () => 'thread-a' }),
    )
    addCodexAppServerHostRequestHandler(
      resource,
      Object.assign(interactive, {
        readThreadId: () => 'thread-a',
        ownsInteractiveRequests: true,
      }),
    )

    const request = {
      id: 1,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-a' },
    } as CodexAppServerServerRequest
    await expect(dispatchCodexAppServerHostRequest(resource, request)).resolves.toBe('interactive')
    expect(passive).not.toHaveBeenCalled()
    expect(interactive).toHaveBeenCalledOnce()

    await disposeCodexAppServerHostResource(resource)
  })
})
