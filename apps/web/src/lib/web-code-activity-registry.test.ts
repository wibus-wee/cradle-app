import type { PluginDescriptor, PluginSourceDescriptor } from '@cradle/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import { codeActivityBus } from '~/features/code-activity/code-activity-bus'

import { registerWebCodeActivitySubscription } from './web-code-activity-registry'

function makeDescriptor(input: {
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
      kind: 'externalLocal',
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
          id: `${owner}:code-activity`,
          owner,
          localId: 'code-activity',
          type: 'code-activity-subscription',
          layer: 'web',
          label: 'Observe code activity',
          permissions: input.capabilityPermissions ?? ['code.activity.read'],
        }],
    declaredPermissions: [{
      id: `${owner}:code.activity.read`,
      owner,
      localId: 'code.activity.read',
      label: 'Read code activity',
      required: true,
    }],
    warnings: [],
    hasWeb: true,
    hasServer: false,
    hasDesktop: false,
  }
}

describe('web code activity registry', () => {
  it('rejects subscriptions without the dedicated capability', () => {
    expect(() => registerWebCodeActivitySubscription(
      'test.plugin',
      () => {},
      makeDescriptor({ declareCapability: false, grantedPermissions: ['code.activity.read'] }),
    )).toThrow(/not declared/)
  })

  it('rejects subscriptions without code.activity.read grant', () => {
    expect(() => registerWebCodeActivitySubscription(
      'test.plugin',
      () => {},
      makeDescriptor({ grantedPermissions: [] }),
    )).toThrow(/code\.activity\.read/)
  })

  it('delivers metadata-only code heartbeats', () => {
    codeActivityBus.clear()
    codeActivityBus.setCurrentTarget({
      workspace: { id: 'workspace-1', name: 'Cradle' },
      file: { relativePath: 'apps/web/src/app.tsx', language: 'typescript' },
    })
    const handler = vi.fn()
    const disposable = registerWebCodeActivitySubscription(
      'test.plugin',
      handler,
      makeDescriptor({ grantedPermissions: ['code.activity.read'] }),
    )

    expect(handler).toHaveBeenCalledWith({
      kind: 'code.heartbeat',
      occurredAt: expect.any(Number),
      workspace: { id: 'workspace-1', name: 'Cradle' },
      file: { relativePath: 'apps/web/src/app.tsx', language: 'typescript' },
      isWrite: false,
    })

    disposable.dispose()
    codeActivityBus.clear()
  })
})
