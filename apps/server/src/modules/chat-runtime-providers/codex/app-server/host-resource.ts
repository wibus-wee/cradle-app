import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
  CodexAppServerNotificationSubscriber,
  CodexAppServerResourceRequestHandler,
} from '../types'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './client'

export function createCodexAppServerHostResource(input: {
  clientOptions: CodexAppServerClientOptions
  createClient: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}): CodexAppServerHostResource {
  const resource = {
    client: undefined as unknown as CodexAppServerClientLike,
    serverRequestHandlers: new Set<CodexAppServerResourceRequestHandler>(),
    notificationSubscribers: new Set<CodexAppServerNotificationSubscriber>(),
  } satisfies CodexAppServerHostResource
  resource.client = input.createClient({
    ...input.clientOptions,
    serverRequestHandler: request => dispatchCodexAppServerHostRequest(resource, request),
  })
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
  const matchingHandlers = handlers.filter(handler => handler.readThreadId?.() === threadId)
  return matchingHandlers.length > 0 ? matchingHandlers : handlers.filter(handler => !handler.readThreadId)
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
  startCodexAppServerHostNotificationPump(resource)

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    resource.notificationSubscribers.delete(subscriber)
    if (resource.notificationSubscribers.size === 0) {
      resource.notificationAbortController?.abort()
      resource.notificationAbortController = undefined
      resource.notificationPump = undefined
    }
  }
}

function startCodexAppServerHostNotificationPump(resource: CodexAppServerHostResource): void {
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

        for (const subscriber of [...resource.notificationSubscribers]) {
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

        if (resource.notificationSubscribers.size === 0) {
          abortController.abort()
        }
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
