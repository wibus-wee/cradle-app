import type { Disposable, PluginLayer, PluginSourceKind } from '@cradle/plugin-sdk'
import type { CodeActivityHandler } from '@cradle/plugin-sdk/web'

import { codeActivityBus } from '~/features/code-activity/code-activity-bus'

const CODE_ACTIVITY_PERMISSION = 'code.activity.read'
const CODE_ACTIVITY_CAPABILITY_TYPE = 'code-activity-subscription'
const CODE_ACTIVITY_CAPABILITY_LOCAL_ID = 'code-activity'

interface CodeActivityAccessDescriptor {
  declaredCapabilities: Array<{
    type: string
    layer?: PluginLayer | null
    localId: string
    permissions: string[]
  }>
  source: {
    kind: PluginSourceKind
    grantedPermissions?: string[]
  }
}

function assertCodeActivityAccess(descriptor: CodeActivityAccessDescriptor | undefined): void {
  if (!descriptor) {
    throw new Error('Code activity subscription requires a plugin descriptor.')
  }

  const capability = descriptor.declaredCapabilities.find(candidate =>
    candidate.type === CODE_ACTIVITY_CAPABILITY_TYPE
    && (candidate.layer == null || candidate.layer === 'web')
    && candidate.localId === CODE_ACTIVITY_CAPABILITY_LOCAL_ID)

  if (!capability) {
    throw new Error(
      `Runtime capability ${CODE_ACTIVITY_CAPABILITY_TYPE}:${CODE_ACTIVITY_CAPABILITY_LOCAL_ID} is not declared in cradle.contributes.capabilities.`,
    )
  }

  if (!capability.permissions.includes(CODE_ACTIVITY_PERMISSION)) {
    throw new Error(
      `Capability ${CODE_ACTIVITY_CAPABILITY_TYPE}:${CODE_ACTIVITY_CAPABILITY_LOCAL_ID} must declare permission ${CODE_ACTIVITY_PERMISSION}.`,
    )
  }

  if (descriptor.source.kind === 'externalLocal') {
    const granted = new Set(descriptor.source.grantedPermissions ?? [])
    if (!granted.has(CODE_ACTIVITY_PERMISSION)) {
      throw new Error(`Missing required plugin permission grants: ${CODE_ACTIVITY_PERMISSION}.`)
    }
  }
}

export function registerWebCodeActivitySubscription(
  pluginName: string,
  handler: CodeActivityHandler,
  descriptor?: CodeActivityAccessDescriptor,
): Disposable {
  assertCodeActivityAccess(descriptor)
  return codeActivityBus.subscribe(pluginName, handler)
}
