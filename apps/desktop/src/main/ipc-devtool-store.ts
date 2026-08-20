import type { AcpDevtoolEvent, IpcObservedEvent } from '@cradle/ipc'
import type { WebContents } from 'electron'

export interface IpcDevtoolStoreOptions {
  maxEvents?: number
  eventChannel?: string
  acpEventChannel?: string
  onIpcSubscriberCountChanged?: (count: number) => void
}

const DEFAULT_MAX_EVENTS = 1000
const DEFAULT_EVENT_CHANNEL = 'ipc-devtool:event'
const DEFAULT_ACP_EVENT_CHANNEL = 'ipc-devtool:acp-event'

export class IpcDevtoolStore {
  private readonly events: IpcObservedEvent[] = []
  private readonly acpEvents: AcpDevtoolEvent[] = []
  private readonly subscribers = new Set<WebContents>()
  private readonly acpSubscribers = new Set<WebContents>()
  private readonly maxEvents: number
  private readonly eventChannel: string
  private readonly acpEventChannel: string
  private readonly onIpcSubscriberCountChanged?: (count: number) => void

  constructor(options: IpcDevtoolStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
    this.eventChannel = options.eventChannel ?? DEFAULT_EVENT_CHANNEL
    this.acpEventChannel = options.acpEventChannel ?? DEFAULT_ACP_EVENT_CHANNEL
    this.onIpcSubscriberCountChanged = options.onIpcSubscriberCountChanged
  }

  record(event: IpcObservedEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }

    for (const subscriber of [...this.subscribers]) {
      if ('isDestroyed' in subscriber && subscriber.isDestroyed()) {
        this.removeIpcSubscriber(subscriber)
        continue
      }

      try {
        subscriber.send(this.eventChannel, event)
      }
      catch {
        this.removeIpcSubscriber(subscriber)
      }
    }
  }

  recordAcp(event: AcpDevtoolEvent): void {
    this.acpEvents.push(event)
    if (this.acpEvents.length > this.maxEvents) {
      this.acpEvents.splice(0, this.acpEvents.length - this.maxEvents)
    }

    for (const subscriber of [...this.acpSubscribers]) {
      if ('isDestroyed' in subscriber && subscriber.isDestroyed()) {
        this.acpSubscribers.delete(subscriber)
        continue
      }

      try {
        subscriber.send(this.acpEventChannel, event)
      }
      catch {
        this.acpSubscribers.delete(subscriber)
      }
    }
  }

  getSnapshot(): IpcObservedEvent[] {
    return [...this.events]
  }

  getAcpSnapshot(): AcpDevtoolEvent[] {
    return [...this.acpEvents]
  }

  clear(): void {
    this.events.length = 0
  }

  clearAcp(): void {
    this.acpEvents.length = 0
  }

  subscribe(webContents: WebContents): () => void {
    const added = !this.subscribers.has(webContents)
    this.subscribers.add(webContents)
    if (added) {
      this.onIpcSubscriberCountChanged?.(this.subscribers.size)
    }

    if ('once' in webContents) {
      webContents.once('destroyed', () => {
        this.removeIpcSubscriber(webContents)
      })
    }

    return () => {
      this.removeIpcSubscriber(webContents)
    }
  }

  subscribeAcp(webContents: WebContents): () => void {
    this.acpSubscribers.add(webContents)

    if ('once' in webContents) {
      webContents.once('destroyed', () => {
        this.acpSubscribers.delete(webContents)
      })
    }

    return () => {
      this.acpSubscribers.delete(webContents)
    }
  }

  private removeIpcSubscriber(webContents: WebContents): void {
    if (this.subscribers.delete(webContents)) {
      this.onIpcSubscriberCountChanged?.(this.subscribers.size)
    }
  }
}
