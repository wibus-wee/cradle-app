import type { Disposable } from '@cradle/plugin-sdk'

import { createChildLogger } from '../logging/logger'

type Handler = (data: unknown) => void

const listeners = new Map<string, Set<Handler>>()
const logger = createChildLogger({ module: 'plugin-event-bus' })

export function emitPluginEvent(event: string, data: unknown): void {
  const handlers = listeners.get(event)
  if (!handlers) { return }
  for (const handler of handlers) {
    try {
      handler(data)
    }
 catch (err) {
      logger.error('plugin event handler failed', { event, err })
    }
  }
}

export function onPluginEvent(event: string, handler: Handler): Disposable {
  if (!listeners.has(event)) {
    listeners.set(event, new Set())
  }
  listeners.get(event)!.add(handler)
  return {
    dispose() {
      listeners.get(event)?.delete(handler)
    },
  }
}

export function createPluginEventBus() {
  return {
    on: onPluginEvent,
    emit: emitPluginEvent,
  }
}
