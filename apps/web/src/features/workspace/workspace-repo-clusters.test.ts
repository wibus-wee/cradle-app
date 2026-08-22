import { describe, expect, it } from 'vitest'

import type { Workspace } from './types'
import { findRepoShadows, groupWorkspacesByRepo } from './workspace-repo-clusters'

function makeWorkspace(id: string, name: string, gitIdentity: Partial<Workspace['gitIdentity']> = {}, pinned = false): Workspace {
  return {
    id,
    name,
    locator: { nodeId: 'local', path: `/tmp/${id}` },
    gitIdentity: gitIdentity as Workspace['gitIdentity'],
    identifier: id.toUpperCase().slice(0, 3),
    availability: 'available',
    multiFolder: false,
    pinned: pinned ? 1 : 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('groupWorkspacesByRepo', () => {
  it('clusters two replicas of the same repository across machines', () => {
    const workspaces = [
      makeWorkspace('a', 'cradle-app', { originUrl: 'git@github.com:wibus/cradle-app.git' }),
      makeWorkspace('b', 'cradle', { originUrl: 'https://github.com/wibus/cradle-app' }),
      makeWorkspace('c', 'other', { originUrl: 'https://github.com/wibus/other.git' }),
    ]
    const { clusters, workspacesWithoutCluster } = groupWorkspacesByRepo(workspaces)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.replicas.map(replica => replica.id)).toEqual(['b', 'a'])
    expect(clusters[0]!.name).toBe('cradle')
    expect(workspacesWithoutCluster.map(workspace => workspace.id)).toEqual(['c'])
  })

  it('never groups workspaces without a git identity or single-copy repos', () => {
    const workspaces = [
      makeWorkspace('scratch', 'scratch'),
      makeWorkspace('solo', 'solo-repo', { originUrl: 'https://github.com/wibus/solo.git' }),
    ]
    const { clusters, workspacesWithoutCluster } = groupWorkspacesByRepo(workspaces)
    expect(clusters).toHaveLength(0)
    expect(workspacesWithoutCluster).toHaveLength(2)
  })

  it('falls back to repoRoot identity when origin is missing on both sides', () => {
    const workspaces = [
      makeWorkspace('x', 'proj', { repoRoot: '/home/x/proj' }),
      makeWorkspace('y', 'proj', { repoRoot: '/home/y/proj' }),
    ]
    // Different roots cannot be matched without an origin — no cluster.
    expect(groupWorkspacesByRepo(workspaces).clusters).toHaveLength(0)

    const sameRoot = [
      makeWorkspace('m', 'proj', { repoRoot: '/data/proj' }),
      makeWorkspace('n', 'proj2', { repoRoot: '/data/proj' }),
    ]
    const grouped = groupWorkspacesByRepo(sameRoot)
    expect(grouped.clusters).toHaveLength(1)
    expect(grouped.clusters[0]!.name).toBe('proj')
  })
})

describe('findRepoShadows', () => {
  it('finds unmounted remote copies of a clustered repository', () => {
    const shadows = findRepoShadows(
      [
        {
          node: { nodeId: 'macbook', nodeName: 'MacBook' },
          workspaces: [{
            id: 'remote-1',
            name: 'cradle-app',
            path: '/Users/x/cradle-app',
            originUrl: 'git@github.com:wibus/cradle-app.git',
          }],
        },
        {
          node: { nodeId: 'desktop', nodeName: 'Desktop' },
          workspaces: [{
            id: 'remote-2',
            name: 'cradle-app',
            path: '/home/y/cradle-app',
            originUrl: 'https://github.com/wibus/cradle-app',
          }],
        },
      ],
      [{ nodeId: 'macbook', path: '/Users/x/cradle-app' }],
    )
    expect(shadows.get('origin:github.com/wibus/cradle-app')).toEqual([
      {
        nodeId: 'desktop',
        nodeName: 'Desktop',
        path: '/home/y/cradle-app',
        sourceWorkspaceId: 'remote-2',
      },
    ])
  })

  it('returns nothing when every copy is already mounted', () => {
    const shadows = findRepoShadows(
      [{
        node: { nodeId: 'macbook', nodeName: 'MacBook' },
        workspaces: [{
          id: 'remote-1',
          name: 'app',
          path: '/Users/x/app',
          originUrl: 'https://github.com/wibus/app.git',
        }],
      }],
      [{ nodeId: 'macbook', path: '/Users/x/app' }],
    )
    expect([...shadows.keys()]).not.toContain('origin:github.com/wibus/app')
  })
})
