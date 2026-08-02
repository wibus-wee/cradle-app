import type { PluginDescriptor, PluginSourceDescriptor } from '@cradle/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import { uiActivityBus } from '~/features/activity/activity-bus'

import { registerWebActivitySubscription } from './web-activity-registry'

function makeDescriptor(input: {
  sourceKind?: PluginSourceDescriptor['kind']
  grantedPermissions?: string[]
  declareCapability?: boolean
  capabilityPermissions?: string[]
}): PluginDescriptor {
  const owner = 'test.plugin'
  return {
    name: owner,
    version: '1.0.0',
    displayName: 'Test',
    identity: owner,
    routeSegment: 'test-plugin',
    source: {
      kind: input.sourceKind ?? 'externalLocal',
      grantedPermissions: input.grantedPermissions ?? [],
    } as PluginSourceDescriptor,
    activation: { enabled: true, source: 'default' },
    layers: {
      web: { layer: 'web', status: 'discovered' },
      server: { layer: 'server', status: 'discovered' },
      desktop: { layer: 'desktop', status: 'discovered' },
    },
    capabilities: [],
    declaredCapabilities: input.declareCapability === false
      ? []
      : [{
          id: `${owner}:ui-activity`,
          owner,
          localId: 'ui-activity',
          type: 'activity-subscription',
          layer: 'web',
          label: 'Observe UI activity',
          permissions: input.capabilityPermissions ?? ['ui.activity.read'],
        }],
    declaredPermissions: [{
      id: `${owner}:ui.activity.read`,
      owner,
      localId: 'ui.activity.read',
      label: 'Read UI activity',
      required: true,
    }],
    warnings: [],
    hasWeb: true,
    hasServer: false,
    hasDesktop: false,
  }
}

describe('web activity registry', () => {
  it('rejects subscribe without declared capability', () => {
    expect(() => registerWebActivitySubscription(
      'test.plugin',
      () => {},
      makeDescriptor({ declareCapability: false, grantedPermissions: ['ui.activity.read'] }),
    )).toThrow(/not declared/)
  })

  it('rejects subscribe without ui.activity.read grant for external plugins', () => {
    expect(() => registerWebActivitySubscription(
      'test.plugin',
      () => {},
      makeDescriptor({ grantedPermissions: [] }),
    )).toThrow(/ui\.activity\.read/)
  })

  it('delivers full entity strings to plugin handlers', () => {
    uiActivityBus.start({ idleTimeoutMs: 60_000 })
    const handler = vi.fn()
    const disposable = registerWebActivitySubscription(
      'test.plugin',
      handler,
      makeDescriptor({ grantedPermissions: ['ui.activity.read'] }),
    )

    uiActivityBus.setResolvedEntity({
      entity: 'apps/web/src/app.tsx',
      entityType: 'file',
    })

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ui.segment.started',
      entity: 'apps/web/src/app.tsx',
      entityType: 'file',
    }))
    expect(uiActivityBus.getCurrentSegment()?.entity).toBe('apps/web/src/app.tsx')

    disposable.dispose()
    uiActivityBus.stop()
  })
})
