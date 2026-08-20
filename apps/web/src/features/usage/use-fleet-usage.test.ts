import { describe, expect, it } from 'vitest'

import type { FabricNode } from '~/features/nodes/types'

import { remoteFleetNodes } from './use-fleet-usage'

function node(nodeId: string): FabricNode {
  return {
    nodeId,
    fabricId: 'fabric-1',
    displayName: nodeId,
    platform: 'darwin',
    version: '1.0.0',
    capabilities: [],
    status: 'online',
    lastSeenAt: '2026-08-20T00:00:00.000Z',
    revision: 1,
  }
}

describe('remoteFleetNodes', () => {
  it('excludes this device from the Fabric directory', () => {
    const nodes = [node('node-local'), node('node-remote')]

    expect(remoteFleetNodes(nodes, 'node-local')).toEqual([node('node-remote')])
  })

  it('returns no remote nodes before local membership is known', () => {
    expect(remoteFleetNodes([node('node-local')], null)).toEqual([])
  })
})
