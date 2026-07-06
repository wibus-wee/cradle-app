// Input: Electron WebContents, shared IPC observed event types
// Output: IpcDevtoolStore ring buffer with live subscriber fan-out
// Position: Main-process backend store for IPC devtool consumers

import type { AcpDevtoolEvent, IpcObservedEvent } from '@cradle/ipc'
import type { WebContents } from 'electron'

export interface IpcDevtoolStoreOptions {
  maxEvents?: number
  eventChannel?: string
  acpEventChannel?: string
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

  constructor(options: IpcDevtoolStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
    this.eventChannel = options.eventChannel ?? DEFAULT_EVENT_CHANNEL
    this.acpEventChannel = options.acpEventChannel ?? DEFAULT_ACP_EVENT_CHANNEL
  }

  record(event: IpcObservedEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }

    for (const subscriber of [...this.subscribers]) {
      if ('isDestroyed' in subscriber && subscriber.isDestroyed()) {
        this.subscribers.delete(subscriber)
        continue
      }

      try {
        subscriber.send(this.eventChannel, event)
      }
      catch {
        this.subscribers.delete(subscriber)
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
    this.subscribers.add(webContents)

    if ('once' in webContents) {
      webContents.once('destroyed', () => {
        this.subscribers.delete(webContents)
      })
    }

    return () => {
      this.subscribers.delete(webContents)
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
}
