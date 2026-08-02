import type { Disposable, PluginDescriptor } from '@cradle/plugin-sdk'
import type { UiActivityEvent, UiActivityHandler } from '@cradle/plugin-sdk/web'

import { uiActivityBus } from '~/features/activity/activity-bus'

const UI_ACTIVITY_PERMISSION = 'ui.activity.read'
const ACTIVITY_CAPABILITY_TYPE = 'activity-subscription'
const ACTIVITY_CAPABILITY_LOCAL_ID = 'ui-activity'

function assertUiActivityAccess(descriptor: PluginDescriptor | undefined): void {
  if (!descriptor) {
    throw new Error('UI activity subscription requires a plugin descriptor.')
  }

  const capability = descriptor.declaredCapabilities.find(candidate =>
    candidate.type === ACTIVITY_CAPABILITY_TYPE
    && (candidate.layer === undefined || candidate.layer === 'web')
    && candidate.localId === ACTIVITY_CAPABILITY_LOCAL_ID)

  if (!capability) {
    throw new Error(
      `Runtime capability ${ACTIVITY_CAPABILITY_TYPE}:${ACTIVITY_CAPABILITY_LOCAL_ID} is not declared in cradle.contributes.capabilities.`,
    )
  }

  if (!capability.permissions.includes(UI_ACTIVITY_PERMISSION)) {
    throw new Error(
      `Capability ${ACTIVITY_CAPABILITY_TYPE}:${ACTIVITY_CAPABILITY_LOCAL_ID} must declare permission ${UI_ACTIVITY_PERMISSION}.`,
    )
  }

  if (descriptor.source.kind === 'externalLocal') {
    const granted = new Set(descriptor.source.grantedPermissions ?? [])
    if (!granted.has(UI_ACTIVITY_PERMISSION)) {
      throw new Error(`Missing required plugin permission grants: ${UI_ACTIVITY_PERMISSION}.`)
    }
  }
}

/** Host-facing registration used by plugin-host `ctx.activities.subscribe`. */
export function registerWebActivitySubscription(
  pluginName: string,
  handler: UiActivityHandler,
  descriptor?: PluginDescriptor,
): Disposable {
  assertUiActivityAccess(descriptor)
  return uiActivityBus.subscribePlugin(pluginName, handler)
}

export function assertWebActivityReadAccess(descriptor?: PluginDescriptor): void {
  assertUiActivityAccess(descriptor)
}

export function formatObservationText(
  activity: Extract<UiActivityEvent, { kind: 'ui.segment.ended' }>,
): string {
  return `[activity] segment ended: entity=${activity.entity} type=${activity.entityType} durationMs=${activity.durationMs} endReason=${activity.endReason}`
}
