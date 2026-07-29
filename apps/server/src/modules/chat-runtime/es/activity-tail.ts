import type { PluginActivity } from '@cradle/plugin-sdk/server'

import { createChildLogger } from '../../../logging/logger'
import type { StoredChatSessionEvent } from './events'

type ChatRunActivitySubscriber = (activity: PluginActivity) => void

const subscribers = new Set<ChatRunActivitySubscriber>()
const logger = createChildLogger({ module: 'chat-run-activity-tail' })

export function subscribeChatRunActivity(subscriber: ChatRunActivitySubscriber): () => void {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export function publishChatRunActivities(events: readonly StoredChatSessionEvent[]): void {
  for (const event of events) {
    const activity = toPluginActivity(event)
    if (!activity) {
      continue
    }
    for (const subscriber of subscribers) {
      try {
        subscriber(activity)
      }
      catch (error) {
        logger.error('chat run activity subscriber failed', { error })
      }
    }
  }
}

function toPluginActivity(event: StoredChatSessionEvent): PluginActivity | null {
  switch (event.type) {
    case 'RunStarted':
      return {
        kind: 'chat.run.started',
        occurredAt: event.occurredAt,
        sessionId: event.aggregateId,
        runId: event.payload.run.id,
        origin: event.payload.run.origin,
      }
    case 'RunCompleted':
    case 'RunFailed':
    case 'RunAborted':
      return {
        kind: 'chat.run.finished',
        occurredAt: event.occurredAt,
        sessionId: event.aggregateId,
        runId: event.payload.runId,
        outcome: event.type === 'RunCompleted'
          ? 'completed'
          : event.type === 'RunFailed'
            ? 'failed'
            : 'aborted',
      }
    default:
      return null
  }
}
