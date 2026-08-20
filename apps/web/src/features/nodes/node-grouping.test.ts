import { describe, expect, it } from 'vitest'

import {
  groupNodesForSidebar,
  mergeNodeWorkspaceInventories,
  resolveNodeDisplayName,
} from './node-grouping'
import type { FabricNode } from './types'

function node(overrides: Partial<FabricNode>): FabricNode {
  return {
    nodeId: 'node-x',
    fabricId: 'fabric-1',
    displayName: 'Node X',
    platform: 'darwin',
    version: '1.0.0',
    capabilities: ['chat', 'terminal'],
    status: 'online',
    lastSeenAt: '2026-08-16T00:00:00.000Z',
    revision: 1,
    ...overrides,
  }
}

describe('groupNodesForSidebar', () => {
  const localNode = node({ nodeId: 'node-local', displayName: 'This Mac', status: 'online' })
  const onlineB = node({ nodeId: 'node-b', displayName: 'Beta box' })
  const onlineA = node({ nodeId: 'node-a', displayName: 'Alpha box' })
  const offline = node({ nodeId: 'node-c', displayName: 'Closet server', status: 'offline' })

  it('puts this device first, then online sorted by name, then offline', () => {
    const groups = groupNodesForSidebar(
      [offline, onlineB, localNode, onlineA],
      'node-local',
    )
    expect(groups.thisDevice?.nodeId).toBe('node-local')
    expect(groups.online.map(n => n.nodeId)).toEqual(['node-a', 'node-b'])
    expect(groups.offline.map(n => n.nodeId)).toEqual(['node-c'])
  })

  it('keeps this device first even when it is offline', () => {
    const groups = groupNodesForSidebar(
      [node({ ...localNode, status: 'offline' }), onlineA],
      'node-local',
    )
    expect(groups.thisDevice?.nodeId).toBe('node-local')
    expect(groups.offline).toEqual([])
  })

  it('handles an unenrolled device (no local node id)', () => {
    const groups = groupNodesForSidebar([offline, onlineB], null)
    expect(groups.thisDevice).toBeNull()
    expect(groups.online.map(n => n.nodeId)).toEqual(['node-b'])
    expect(groups.offline.map(n => n.nodeId)).toEqual(['node-c'])
  })
})

describe('resolveNodeDisplayName', () => {
  it('resolves a known node id', () => {
    expect(resolveNodeDisplayName([node({ nodeId: 'n1', displayName: 'Devbox' })], 'n1')).toBe(
      'Devbox',
    )
  })

  it('returns null for unknown or empty ids', () => {
    expect(resolveNodeDisplayName([node({ nodeId: 'n1' })], 'nope')).toBeNull()
    expect(resolveNodeDisplayName([node({ nodeId: 'n1' })], null)).toBeNull()
  })
})

describe('mergeNodeWorkspaceInventories', () => {
  const nodeA = { nodeId: 'node-a', nodeName: 'Alpha box' }
  const nodeB = { nodeId: 'node-b', nodeName: 'Beta box' }

  it('merges the same Git repository across Nodes into one entry', () => {
    const entries = mergeNodeWorkspaceInventories(
      [
        {
          node: nodeA,
          workspaces: [{
            id: 'wa',
            name: 'cradle',
            path: '/home/a/cradle',
            originUrl: 'git@github.com:cradle/cradle-app.git',
            repoRoot: '/home/a/cradle',
          }],
        },
        {
          node: nodeB,
          workspaces: [{
            id: 'wb',
            name: 'cradle',
            path: '/Users/b/cradle',
            originUrl: 'https://github.com/cradle/cradle-app.git',
            repoRoot: '/Users/b/cradle',
          }],
        },
      ],
      [],
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].targets.map(target => target.nodeId)).toEqual(['node-a', 'node-b'])
  })

  it('does not merge workspaces without a Git identity', () => {
    const entries = mergeNodeWorkspaceInventories(
      [
        { node: nodeA, workspaces: [{ id: 'wa', name: 'scratch', path: '/tmp/scratch' }] },
        { node: nodeB, workspaces: [{ id: 'wb', name: 'scratch', path: '/tmp/scratch' }] },
      ],
      [],
    )
    expect(entries).toHaveLength(2)
  })

  it('falls back to repoRoot when originUrl is missing', () => {
    const entries = mergeNodeWorkspaceInventories(
      [
        { node: nodeA, workspaces: [{ id: 'wa', name: 'repo', path: '/r', repoRoot: '/r' }] },
        { node: nodeB, workspaces: [{ id: 'wb', name: 'repo', path: '/r', repoRoot: '/r' }] },
      ],
      [],
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].targets).toHaveLength(2)
  })

  it('marks targets already mounted with the same locator', () => {
    const entries = mergeNodeWorkspaceInventories(
      [{
        node: nodeA,
        workspaces: [{ id: 'wa', name: 'cradle', path: '/home/a/cradle', originUrl: 'o' }],
      }],
      [{ nodeId: 'node-a', path: '/home/a/cradle' }],
    )
    expect(entries[0].targets[0].alreadyAdded).toBe(true)
  })

  it('sorts entries by name', () => {
    const entries = mergeNodeWorkspaceInventories(
      [{
        node: nodeA,
        workspaces: [
          { id: 'w2', name: 'zeta', path: '/z', originUrl: 'z' },
          { id: 'w1', name: 'alpha', path: '/a', originUrl: 'a' },
        ],
      }],
      [],
    )
    expect(entries.map(entry => entry.name)).toEqual(['alpha', 'zeta'])
  })
})
