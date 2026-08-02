import type { Disposable } from '@cradle/plugin-sdk'
import type { UiActivityEvent } from '@cradle/plugin-sdk/web'

import { uiActivityBus } from '~/features/activity/activity-bus'
import { isTearoffWindow } from '~/lib/electron'

import { trackProductEvent } from './client'
import { bucketProductAnalyticsDuration } from './event-model'

/**
 * Privacy-safe analytics projection of UI activity segments.
 * Never forwards raw entity strings, paths, or session/work ids.
 * Tearoff windows are skipped (same policy as app_opened).
 */
export function installActivityAnalyticsSink(): Disposable {
  return uiActivityBus.subscribeHost('product-analytics', (event: UiActivityEvent) => {
    if (isTearoffWindow) {
      return
    }

    if (event.kind === 'ui.segment.started') {
      trackProductEvent('activity_segment_started', {
        entity_type: event.entityType,
        previous_entity_type: event.previousEntityType,
      })
      return
    }

    trackProductEvent('activity_segment_ended', {
      entity_type: event.entityType,
      duration_bucket: bucketProductAnalyticsDuration(event.durationMs),
      end_reason: event.endReason,
    })
  })
}
