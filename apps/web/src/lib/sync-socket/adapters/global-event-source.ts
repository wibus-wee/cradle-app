import type { GlobalSessionEventSource } from '~/features/session/global-session-sync-engine'

import {
  subscribeSyncChannel,
  unsubscribeSyncChannel,
  updateSyncSubscriptionCursor,
} from '../client'

export function createSyncGlobalSessionEventSource(input: {
  afterSequenceId: number
  workspaceId?: string | null
}): GlobalSessionEventSource {
  const subId = crypto.randomUUID()
  const sessionListeners = new Set<(event: MessageEvent<string>) => void>()
  const errorListeners = new Set<(event: Event) => void>()
  let closed = false

  subscribeSyncChannel(
    {
      op: 'sub',
      subId,
      channel: 'sessions-tail',
      afterSequenceId: input.afterSequenceId,
      workspaceId: input.workspaceId ?? undefined,
    },
    (frame) => {
      if (closed) {
        return
      }
      if (!('kind' in frame)) {
        return
      }
      if (frame.kind === 'tail-event') {
        if ('sequenceId' in frame.event && typeof frame.event.sequenceId === 'number') {
          updateSyncSubscriptionCursor(subId, frame.event.sequenceId)
        }
        const message = new MessageEvent('sessions', { data: JSON.stringify(frame.event) })
        for (const listener of sessionListeners) {
          listener(message)
        }
        return
      }
      if (frame.kind === 'end') {
        dispatchError()
      }
    },
  )

  return {
    addEventListener(type, listener) {
      if (type === 'sessions') {
        sessionListeners.add(listener as (event: MessageEvent<string>) => void)
        return
      }
      errorListeners.add(listener as (event: Event) => void)
    },
    close() {
      if (closed) {
        return
      }
      closed = true
      unsubscribeSyncChannel(subId)
      sessionListeners.clear()
      errorListeners.clear()
    },
  }

  function dispatchError(): void {
    const event = new Event('error')
    for (const listener of errorListeners) {
      listener(event)
    }
  }
}
