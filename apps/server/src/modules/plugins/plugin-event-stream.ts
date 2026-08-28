import { openSseEventStream } from '../../infra/sse-event-stream'
import type { PluginDevSessionEvent } from './dev-session-service'
import { pluginDevSessions } from './dev-session-service'
import type { PluginLifecycleEvent } from './lifecycle-service'
import { pluginLifecycle } from './lifecycle-service'

type PluginEvent
  = | { scope: 'lifecycle', event: PluginLifecycleEvent }
    | { scope: 'dev-session', event: PluginDevSessionEvent }

export function openPluginEventStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  return openSseEventStream<PluginEvent>({
    signal,
    overflow: 'drop-oldest',
    source: {
      subscribe: (listener) => {
        const unsubscribeLifecycle = pluginLifecycle.subscribe(event => listener({
          scope: 'lifecycle',
          event,
        }))
        const unsubscribeDevSessions = pluginDevSessions.subscribe(event => listener({
          scope: 'dev-session',
          event,
        }))
        return () => {
          unsubscribeLifecycle()
          unsubscribeDevSessions()
        }
      },
    },
  })
}
