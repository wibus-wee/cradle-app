import type { DownloadTaskView } from '@cradle/download-center'

import { openSseEventStream } from '../../infra/sse-event-stream'

type Listener = (task: DownloadTaskView) => void

export class DownloadTaskEvents {
  private readonly listeners = new Set<Listener>()

  publish(task: DownloadTaskView): void {
    for (const listener of this.listeners) { listener(task) }
  }

  stream(signal: AbortSignal): ReadableStream<Uint8Array> {
    return openSseEventStream({
      signal,
      overflow: 'drop-oldest',
      source: {
        subscribe: (listener) => {
          this.listeners.add(listener)
          return () => {
            this.listeners.delete(listener)
          }
        },
      },
    })
  }

  get listenerCount(): number { return this.listeners.size }
}
