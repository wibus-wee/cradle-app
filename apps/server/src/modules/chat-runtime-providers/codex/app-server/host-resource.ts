import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
  CodexAppServerNotificationSubscriber,
  CodexAppServerResourceRequestHandler,
  ThreadResponse,
} from '../types'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './client'

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
    onTerminated: (error) => {
      if (!resource?.disposing) {
        resource?.onTerminated?.(error)
      }
    },
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
    notificationOwnershipWaiters: new Set(),
    pendingThreadBinderCount: 0,
    discardedNotificationCount: 0,
    loadedThreadIds: new Set<string>(),
    threadBindPromises: new Map<string, Promise<ThreadResponse>>(),
    skillExtraRoots: new Set<string>(),
    uiSlotThreadFacts: new Map(),
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
  if (handlers.length !== 1) {
    throw new Error(`Codex app-server host cannot route server request without an exact thread owner: ${request.method}`)
  }
  return await handlers[0]!(request)
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
  signalCodexNotificationOwnershipChange(resource)
  startCodexAppServerHostNotificationPump(resource)

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    resource.notificationSubscribers.delete(subscriber)
    signalCodexNotificationOwnershipChange(resource)
  }
}

export function createCodexAppServerLeaseClient(
  resource: CodexAppServerHostResource,
  readThreadId?: () => string | null,
  onThreadId?: (threadId: string) => void,
): CodexAppServerClientLike {
  const waiters: Array<(message: CodexAppServerMessage | null) => void> = []
  let inferredThreadId: string | null = null
  let closed = false
  let unsubscribe: (() => void) | null = null
  let acknowledgeDelivery: (() => void) | null = null
  let wakeMessageConsumer: (() => void) | null = null
  const currentThreadId = () => inferredThreadId ?? readThreadId?.() ?? null
  let bindingPending = currentThreadId() === null
  if (bindingPending) {
    resource.pendingThreadBinderCount += 1
  }
  startCodexAppServerHostNotificationPump(resource)
  const finishBinding = () => {
    if (!bindingPending) {
      return
    }
    bindingPending = false
    resource.pendingThreadBinderCount -= 1
    signalCodexNotificationOwnershipChange(resource)
  }
  const ensureSubscribed = () => {
    if (unsubscribe || closed) {
      return
    }
    unsubscribe = subscribeCodexAppServerHostNotifications(resource, {
      readThreadId: currentThreadId,
      onMessage: async (message) => {
        if (waiters.length === 0) {
          await new Promise<void>((resolve) => {
            wakeMessageConsumer = resolve
          })
          wakeMessageConsumer = null
        }
        if (closed) {
          return true
        }
        const waiter = waiters.shift()
        if (!waiter) {
          return false
        }
        const consumed = new Promise<void>((resolve) => {
          acknowledgeDelivery = resolve
        })
        waiter(message)
        await consumed
        return closed
      },
      onClose: () => {
        closed = true
        wakeMessageConsumer?.()
        wakeMessageConsumer = null
        acknowledgeDelivery?.()
        acknowledgeDelivery = null
        for (const waiter of waiters.splice(0)) {
          waiter(null)
        }
      },
    })
  }
  if (bindingPending) {
    ensureSubscribed()
  }

  const close = () => {
    if (closed) {
      return
    }
    closed = true
    finishBinding()
    unsubscribe?.()
    unsubscribe = null
    wakeMessageConsumer?.()
    wakeMessageConsumer = null
    acknowledgeDelivery?.()
    acknowledgeDelivery = null
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
      if (startsCodexNotificationStream(method)) {
        ensureSubscribed()
      }
      const result = await resource.client.request(method, params)
      if (method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') {
        const threadId = readResponseThreadId(result)
        if (threadId) {
          inferredThreadId = threadId
          finishBinding()
          onThreadId?.(threadId)
          signalCodexNotificationOwnershipChange(resource)
        }
      }
      return result
    },
    nextNotification: async (signal?: AbortSignal) => {
      if (closed || signal?.aborted) {
        return null
      }
      acknowledgeDelivery?.()
      acknowledgeDelivery = null
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
        ensureSubscribed()
        wakeMessageConsumer?.()
      })
    },
    close,
  }
}

function startsCodexNotificationStream(method: string): boolean {
  if (method === 'turn/start'
    || method === 'review/start'
    || method === 'thread/compact/start'
    || method === 'thread/shellCommand') {
    return true
  }
  return method === 'thread/goal/set'
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
        let subscribers = selectCodexAppServerNotificationSubscribers(resource, threadId)
        if (threadId && subscribers.length === 0) {
          const hasInFlightBinder = resource.pendingThreadBinderCount > 0 || [...resource.notificationSubscribers]
            .some(subscriber => !subscriber.readThreadId?.())
          if (hasInFlightBinder) {
            await waitForCodexNotificationOwnershipChange(resource, abortController.signal)
            subscribers = selectCodexAppServerNotificationSubscribers(resource, threadId)
          }
          if (subscribers.length === 0) {
            resource.discardedNotificationCount += 1
            continue
          }
        }
        await deliverCodexAppServerNotification(resource, subscribers, message)
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

async function deliverCodexAppServerNotification(
  resource: CodexAppServerHostResource,
  subscribers: CodexAppServerNotificationSubscriber[],
  message: CodexAppServerMessage,
): Promise<void> {
  for (const subscriber of subscribers) {
    let shouldUnsubscribe = false
    try {
      shouldUnsubscribe = await subscriber.onMessage(message)
    }
    catch {
      shouldUnsubscribe = true
    }
    if (shouldUnsubscribe) {
      resource.notificationSubscribers.delete(subscriber)
    }
  }
}

function signalCodexNotificationOwnershipChange(resource: CodexAppServerHostResource): void {
  for (const waiter of resource.notificationOwnershipWaiters) {
    waiter()
  }
  resource.notificationOwnershipWaiters.clear()
}

async function waitForCodexNotificationOwnershipChange(
  resource: CodexAppServerHostResource,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return
  }
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', finish)
      resource.notificationOwnershipWaiters.delete(finish)
      resolve()
    }
    resource.notificationOwnershipWaiters.add(finish)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export async function disposeCodexAppServerHostResource(
  resource: CodexAppServerHostResource,
): Promise<void> {
  resource.disposing = true
  for (const subscriber of [...resource.notificationSubscribers]) {
    subscriber.onClose()
  }
  resource.notificationSubscribers.clear()
  signalCodexNotificationOwnershipChange(resource)
  resource.uiSlotThreadFacts.clear()
  resource.notificationAbortController?.abort()
  await resource.client.close()
  await resource.notificationPump?.catch(() => undefined)
}
