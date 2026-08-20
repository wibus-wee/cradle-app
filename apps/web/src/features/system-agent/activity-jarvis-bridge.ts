import type { Disposable } from '@cradle/plugin-sdk'

import { uiActivityBus } from '~/features/activity/activity-bus'
import type { UiActivityEvent } from '~/features/activity/types'
import {
  AMBIENT_OBSERVATION_LIMIT,
  MIN_OBSERVATION_DURATION_MS,
} from '~/features/activity/types'

import type { JarvisAmbientSessionPrefs } from './jarvis-ambient-session'
import {
  clearJarvisAmbientSessionId,
  ensureJarvisAmbientSession,
} from './jarvis-ambient-session'

const recentObservationTexts: string[] = []
type SegmentEndedEvent = Extract<UiActivityEvent, { kind: 'ui.segment.ended' }>

export function formatObservationText(activity: SegmentEndedEvent): string {
  return `[activity] segment ended: entity=${activity.entity} type=${activity.entityType} durationMs=${activity.durationMs} endReason=${activity.endReason}`
}

function rememberObservationText(text: string): void {
  recentObservationTexts.unshift(text)
  if (recentObservationTexts.length > AMBIENT_OBSERVATION_LIMIT) {
    recentObservationTexts.length = AMBIENT_OBSERVATION_LIMIT
  }
}

/** Sync cache for Jarvis send — filled when observations are appended. */
export function readRecentAmbientObservationTexts(): string[] {
  return recentObservationTexts.slice(0, AMBIENT_OBSERVATION_LIMIT)
}

export function clearRecentAmbientObservationTextsForTests(): void {
  recentObservationTexts.length = 0
}

async function defaultPostObservation(
  sessionId: string,
  activity: SegmentEndedEvent,
  text: string,
): Promise<void> {
  const { postChatSessionsBySessionIdObservations } = await import('~/api-gen/sdk.gen')
  const res = await postChatSessionsBySessionIdObservations({
    path: { sessionId },
    body: {
      text,
      entity: activity.entity,
      entityType: activity.entityType,
      durationMs: activity.durationMs,
      endReason: activity.endReason,
    },
  })
  if (res.error) {
    const status = typeof res.response?.status === 'number' ? res.response.status : 0
    if (status === 404 || status === 409) {
      clearJarvisAmbientSessionId()
    }
    throw new Error('Observation append failed')
  }
}

/**
 * Persists metadata-only observation user messages on segment end.
 * Does not start Chat Runtime runs.
 */
export function installJarvisActivityBridge(options?: {
  getPrefs?: () => JarvisAmbientSessionPrefs | null
  postObservation?: (sessionId: string, activity: SegmentEndedEvent, text: string) => Promise<void>
  minDurationMs?: number
}): Disposable {
  const minDurationMs = options?.minDurationMs ?? MIN_OBSERVATION_DURATION_MS
  const getPrefs = options?.getPrefs ?? (() => null)
  const postObservation = options?.postObservation ?? defaultPostObservation

  return uiActivityBus.subscribeHost('jarvis-ambient', async (activity: UiActivityEvent) => {
    if (activity.kind !== 'ui.segment.ended') {
      return
    }
    if (activity.durationMs < minDurationMs) {
      return
    }

    const prefs = getPrefs()
    if (!prefs?.profileId) {
      return
    }

    try {
      const sessionId = await ensureJarvisAmbientSession(prefs)
      const text = formatObservationText(activity)
      if (text.includes('<cradle_context>')) {
        return
      }
      await postObservation(sessionId, activity, text)
      rememberObservationText(text)
    }
    catch (error) {
      console.error('[jarvis-ambient] failed to append observation', error)
    }
  })
}
