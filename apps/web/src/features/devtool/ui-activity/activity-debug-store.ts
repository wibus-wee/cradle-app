import { uiActivityBus } from '~/features/activity/activity-bus'
import type { UiActivityResolutionInputs } from '~/features/activity/resolution-inputs'
import { readUiActivityResolutionInputs } from '~/features/activity/resolution-inputs'
import type { UiActivityEvent, UiActivitySegment } from '~/features/activity/types'
import { IDLE_TIMEOUT_MS } from '~/features/activity/types'

const RECENT_EVENTS_LIMIT = 20
const DEBUG_OWNER = 'activity-debug'

export interface ActivityDebugSnapshot {
  now: number
  segment: UiActivitySegment | null
  resolution: UiActivityResolutionInputs
  recentEvents: UiActivityEvent[]
  subscribers: {
    host: string[]
    plugin: string[]
  }
  idleTimeoutMs: number
}

const recentEvents: UiActivityEvent[] = []
const listeners = new Set<() => void>()
let pollId: number | null = null
let busSubscription: { dispose: () => void } | null = null

function buildSnapshot(): ActivityDebugSnapshot {
  const subscribers = uiActivityBus.listSubscriberOwners()
  return {
    now: Date.now(),
    segment: uiActivityBus.getCurrentSegment(),
    resolution: readUiActivityResolutionInputs(),
    recentEvents: [...recentEvents],
    subscribers: {
      host: subscribers.host.filter(owner => owner !== DEBUG_OWNER),
      plugin: subscribers.plugin,
    },
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  }
}

let snapshot: ActivityDebugSnapshot | null = null

function getSnapshot(): ActivityDebugSnapshot {
  if (!snapshot) {
    snapshot = buildSnapshot()
  }
  return snapshot
}

function notify(): void {
  snapshot = buildSnapshot()
  for (const listener of listeners) {
    listener()
  }
}

function ensureActivityDebugStore(): void {
  if (busSubscription) {
    return
  }

  busSubscription = uiActivityBus.subscribeHost(DEBUG_OWNER, (event) => {
    recentEvents.unshift(event)
    if (recentEvents.length > RECENT_EVENTS_LIMIT) {
      recentEvents.length = RECENT_EVENTS_LIMIT
    }
    notify()
  })

  pollId = window.setInterval(() => {
    notify()
  }, 1000)
}

export function subscribeActivityDebug(listener: () => void): () => void {
  ensureActivityDebugStore()
  listeners.add(listener)
  listener()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (pollId !== null) {
        window.clearInterval(pollId)
        pollId = null
      }
      busSubscription?.dispose()
      busSubscription = null
      snapshot = null
    }
  }
}

export function getActivityDebugSnapshot(): ActivityDebugSnapshot {
  ensureActivityDebugStore()
  return getSnapshot()
}
