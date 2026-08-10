import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
  CodexAppServerNotificationSubscriber,
  CodexAppServerResourceRequestHandler,
  ThreadResponse,
} from '../types'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './client'

const MAX_PENDING_NOTIFICATIONS_PER_THREAD = 100
const MAX_PENDING_NOTIFICATION_THREADS = 100

function readMessageThreadId(message: CodexAppServerMessage): string | null {
  const params = message.params
  if (!params || typeof params !== 'object' || !('threadId' in params)) {
    return null
  }
  const threadId = (params as { threadId?: unknown }).threadId
  return typeof threadId === 'string' ? threadId : null
}

export function createCodexAppServerHostResource(input: {
  clientOptions: CodexAppServerClientOptions
  createClient: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}): CodexAppServerHostResource {
  let resource: CodexAppServerHostResource | null = null
  const client = input.createClient({
    ...input.clientOptions,
    serverRequestHandler: (request) => {
      if (!resource) {
        throw new Error('Codex app-server host received a request before resource initialization')
      }
      return dispatchCodexAppServerHostRequest(resource, request)
    },
  })
  resource = {
    client,
    serverRequestHandlers: new Set<CodexAppServerResourceRequestHandler>(),
    notificationSubscribers: new Set<CodexAppServerNotificationSubscriber>(),
    pendingNotificationsByThreadId: new Map<string, CodexAppServerMessage[]>(),
    loadedThreadIds: new Set<string>(),
    threadBindPromises: new Map<string, Promise<ThreadResponse>>(),
    skillExtraRoots: new Set<string>(),
  }
  return resource
}

export function addCodexAppServerHostRequestHandler(
  resource: CodexAppServerHostResource,
  handler: CodexAppServerResourceRequestHandler,
): () => void {
  resource.serverRequestHandlers.add(handler)
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    resource.serverRequestHandlers.delete(handler)
  }
}

export async function dispatchCodexAppServerHostRequest(
  resource: CodexAppServerHostResource,
  request: CodexAppServerServerRequest,
): Promise<unknown> {
  const handlers = selectCodexAppServerHostRequestHandlers(resource, request)
  if (handlers.length === 0) {
    throw new Error(`Codex app-server host has no handler for server request: ${request.method}`)
  }

  const [firstHandler, ...sideEffectHandlers] = handlers
  const result = await firstHandler(request)
  for (const handler of sideEffectHandlers) {
    await Promise.resolve(handler(request)).catch(() => undefined)
  }
  return result
}

function selectCodexAppServerHostRequestHandlers(
  resource: CodexAppServerHostResource,
  request: CodexAppServerServerRequest,
): CodexAppServerResourceRequestHandler[] {
  const handlers = [...resource.serverRequestHandlers]
  const threadId = readCodexAppServerRequestThreadId(request)
  if (!threadId) {
    return handlers
  }
  return handlers.filter(handler => handler.readThreadId?.() === threadId)
}

function readCodexAppServerRequestThreadId(request: CodexAppServerServerRequest): string | null {
  const params = request.params
  if (!params || typeof params !== 'object' || !('threadId' in params)) {
    return null
  }
  const threadId = (params as { threadId?: unknown }).threadId
  return typeof threadId === 'string' ? threadId : null
}

export function subscribeCodexAppServerHostNotifications(
  resource: CodexAppServerHostResource,
  subscriber: CodexAppServerNotificationSubscriber,
): () => void {
  resource.notificationSubscribers.add(subscriber)
  flushPendingCodexAppServerNotifications(resource, subscriber)
  startCodexAppServerHostNotificationPump(resource)

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    resource.notificationSubscribers.delete(subscriber)
  }
}

export function createCodexAppServerLeaseClient(
  resource: CodexAppServerHostResource,
  readThreadId?: () => string | null,
  onThreadId?: (threadId: string) => void,
): CodexAppServerClientLike {
  const queue: CodexAppServerMessage[] = []
  const waiters: Array<(message: CodexAppServerMessage | null) => void> = []
  let inferredThreadId: string | null = null
  let closed = false
  const currentThreadId = () => inferredThreadId ?? readThreadId?.() ?? null
  const unsubscribe = subscribeCodexAppServerHostNotifications(resource, {
    readThreadId: currentThreadId,
    onMessage: (message) => {
      const waiter = waiters.shift()
      if (waiter) {
        waiter(message)
      }
      else {
        queue.push(message)
      }
      return false
    },
    onClose: () => {
      closed = true
      for (const waiter of waiters.splice(0)) {
        waiter(null)
      }
    },
  })

  const close = () => {
    if (closed) {
      return
    }
    closed = true
    unsubscribe()
    for (const waiter of waiters.splice(0)) {
      waiter(null)
    }
  }

  return {
    get pid() {
      return resource.client.pid
    },
    initialize: resource.client.initialize.bind(resource.client),
    request: async (method, params) => {
      const result = await resource.client.request(method, params)
      if (method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') {
        const threadId = readResponseThreadId(result)
        if (threadId) {
          inferredThreadId = threadId
          onThreadId?.(threadId)
          flushPendingCodexAppServerNotifications(resource)
        }
      }
      return result
    },
    nextNotification: async (signal?: AbortSignal) => {
      if (queue.length > 0) {
        return queue.shift() ?? null
      }
      if (closed || signal?.aborted) {
        return null
      }
      return await new Promise<CodexAppServerMessage | null>((resolve) => {
        let waiter: ((message: CodexAppServerMessage | null) => void) | null = null
        const onAbort = () => {
          const index = waiter ? waiters.indexOf(waiter) : -1
          if (index >= 0) {
            waiters.splice(index, 1)
          }
          resolve(null)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        waiter = (message) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(message)
        }
        waiters.push(waiter)
      })
    },
    close,
  }
}

function readResponseThreadId(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('thread' in result)) {
    return null
  }
  const thread = (result as { thread?: unknown }).thread
  if (!thread || typeof thread !== 'object' || !('id' in thread)) {
    return null
  }
  const threadId = (thread as { id?: unknown }).id
  return typeof threadId === 'string' ? threadId : null
}

export function startCodexAppServerHostNotificationPump(resource: CodexAppServerHostResource): void {
  if (resource.notificationPump) {
    return
  }

  const abortController = new AbortController()
  resource.notificationAbortController = abortController
  resource.notificationPump = (async () => {
    try {
      while (!abortController.signal.aborted) {
        let message: CodexAppServerMessage | null
        try {
          message = await resource.client.nextNotification(abortController.signal)
        }
        catch (error) {
          if (abortController.signal.aborted) {
            return
          }
          throw error
        }
        if (!message) {
          return
        }

        const threadId = readMessageThreadId(message)
        const subscribers = selectCodexAppServerNotificationSubscribers(resource, threadId)
        if (threadId && subscribers.length === 0) {
          const pending = resource.pendingNotificationsByThreadId.get(threadId) ?? []
          if (!resource.pendingNotificationsByThreadId.has(threadId)
            && resource.pendingNotificationsByThreadId.size >= MAX_PENDING_NOTIFICATION_THREADS) {
            const oldestThreadId = resource.pendingNotificationsByThreadId.keys().next().value
            if (oldestThreadId) {
              resource.pendingNotificationsByThreadId.delete(oldestThreadId)
            }
          }
          pending.push(message)
          if (pending.length > MAX_PENDING_NOTIFICATIONS_PER_THREAD) {
            pending.shift()
          }
          resource.pendingNotificationsByThreadId.set(threadId, pending)
          continue
        }
        deliverCodexAppServerNotification(resource, subscribers, message)
      }
    }
    finally {
      for (const subscriber of [...resource.notificationSubscribers]) {
        subscriber.onClose()
      }
      resource.notificationSubscribers.clear()
      if (resource.notificationAbortController === abortController) {
        resource.notificationAbortController = undefined
        resource.notificationPump = undefined
      }
    }
  })()
}

function selectCodexAppServerNotificationSubscribers(
  resource: CodexAppServerHostResource,
  threadId: string | null,
): CodexAppServerNotificationSubscriber[] {
  return threadId
    ? [...resource.notificationSubscribers].filter(subscriber => subscriber.readThreadId?.() === threadId)
    : [...resource.notificationSubscribers]
}

function deliverCodexAppServerNotification(
  resource: CodexAppServerHostResource,
  subscribers: CodexAppServerNotificationSubscriber[],
  message: CodexAppServerMessage,
): void {
  for (const subscriber of subscribers) {
    let shouldUnsubscribe = false
    try {
      shouldUnsubscribe = subscriber.onMessage(message)
    }
    catch {
      shouldUnsubscribe = true
    }
    if (shouldUnsubscribe) {
      resource.notificationSubscribers.delete(subscriber)
    }
  }
}

function flushPendingCodexAppServerNotifications(
  resource: CodexAppServerHostResource,
  onlySubscriber?: CodexAppServerNotificationSubscriber,
): void {
  const threadIds = onlySubscriber
    ? [onlySubscriber.readThreadId?.() ?? null]
    : [...new Set(Array.from(resource.notificationSubscribers, subscriber => subscriber.readThreadId?.() ?? null))]
  for (const threadId of threadIds) {
    if (!threadId) {
      continue
    }
    const pending = resource.pendingNotificationsByThreadId.get(threadId)
    if (!pending?.length) {
      continue
    }
    const subscribers = onlySubscriber
      ? [onlySubscriber]
      : selectCodexAppServerNotificationSubscribers(resource, threadId)
    resource.pendingNotificationsByThreadId.delete(threadId)
    for (const message of pending) {
      deliverCodexAppServerNotification(resource, subscribers, message)
    }
  }
}

export async function disposeCodexAppServerHostResource(
  resource: CodexAppServerHostResource,
): Promise<void> {
  resource.notificationAbortController?.abort()
  await resource.client.close()
  await resource.notificationPump?.catch(() => undefined)
}
