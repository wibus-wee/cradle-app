import { randomUUID } from 'node:crypto'

import { openSseEventStream } from '../../infra/sse-event-stream'

export type PluginLifecycleEventType
  = | 'source-installed'
    | 'source-updated'
    | 'source-refreshed'
    | 'source-removed'
    | 'activation-changed'
    | 'review-completed'

export interface PluginLifecycleEvent {
  id: string
  type: PluginLifecycleEventType
  sourceId: string | null
  pluginIdentities: string[]
  chatSessionId: string | null
  createdAt: number
}

export interface PendingPluginReview {
  sourceId: string
  chatSessionId: string
  createdAt: number
}

class PluginLifecycleService {
  private readonly listeners = new Set<(event: PluginLifecycleEvent) => void>()
  private readonly pendingReviews = new Map<string, PendingPluginReview>()

  publish(input: Omit<PluginLifecycleEvent, 'id' | 'createdAt'>): PluginLifecycleEvent {
    const event: PluginLifecycleEvent = {
      ...input,
      id: randomUUID(),
      pluginIdentities: [...new Set(input.pluginIdentities)].sort(),
      createdAt: Date.now(),
    }
    if (input.chatSessionId && input.sourceId && input.type !== 'source-removed') {
      this.pendingReviews.set(input.sourceId, {
        sourceId: input.sourceId,
        chatSessionId: input.chatSessionId,
        createdAt: event.createdAt,
      })
    }
    if (input.sourceId && (input.type === 'source-removed' || input.type === 'review-completed')) {
      this.pendingReviews.delete(input.sourceId)
    }
    for (const listener of this.listeners) {
      listener(event)
    }
    return event
  }

  listPendingReviews(chatSessionId: string): PendingPluginReview[] {
    return [...this.pendingReviews.values()]
      .filter(review => review.chatSessionId === chatSessionId)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  clearPendingReview(sourceId: string): void {
    this.pendingReviews.delete(sourceId)
  }

  stream(signal: AbortSignal): ReadableStream<Uint8Array> {
    return openSseEventStream({
      signal,
      overflow: 'drop-oldest',
      source: {
        subscribe: (listener) => {
          this.listeners.add(listener)
          return () => this.listeners.delete(listener)
        },
      },
    })
  }
}

export const pluginLifecycle = new PluginLifecycleService()
