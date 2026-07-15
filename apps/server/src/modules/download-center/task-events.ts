import type { DownloadTaskView } from '@cradle/download-center'

type Listener = (task: DownloadTaskView) => void

export class DownloadTaskEvents {
  private readonly listeners = new Set<Listener>()

  publish(task: DownloadTaskView): void {
    for (const listener of this.listeners) { listener(task) }
  }

  stream(signal: AbortSignal): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    let unsubscribe = (): void => undefined
    return new ReadableStream({
      start: (controller) => {
        const emit = (task: DownloadTaskView) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(task)}\n\n`))
        const listener: Listener = emit
        const onAbort = (): void => {
          unsubscribe()
          controller.close()
        }
        unsubscribe = (): void => {
          this.listeners.delete(listener)
          signal.removeEventListener('abort', onAbort)
        }
        this.listeners.add(listener)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) { onAbort() }
      },
      cancel: () => unsubscribe(),
    })
  }

  get listenerCount(): number { return this.listeners.size }
}
