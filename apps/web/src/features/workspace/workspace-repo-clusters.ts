import type { NodeWorkspaceEntry, NodeWorkspaceTarget } from '~/features/nodes/node-grouping'
import { mergeNodeWorkspaceInventories } from '~/features/nodes/node-grouping'
import { repoDisplayNameFromKey, workspaceRepoKey } from '~/lib/repo-identity'

import type { Workspace } from './types'

/**
 * Pure repo-cluster derivation for the workspace sidebar. No query/store
 * imports — the same functions drive Stories fixtures and tests.
 */

/** Mounted workspace replicas of one repository across machines. */
export interface WorkspaceRepoCluster {
  /** Stable key from `workspaceRepoKey` (only git-backed repos cluster). */
  key: string
  name: string
  replicas: Workspace[]
}

export interface WorkspaceRepoGrouping {
  clusters: WorkspaceRepoCluster[]
  workspacesWithoutCluster: Workspace[]
}

/**
 * Cluster mounted workspaces by repository identity.
 *
 * Only repositories with two or more replicas produce a cluster — single-copy
 * users see exactly the flat list they know. `ungrouped` preserves the caller's
 * ordering; `clusters` are sorted by display name for determinism.
 */
export function groupWorkspacesByRepo(workspaces: readonly Workspace[]): WorkspaceRepoGrouping {
  const keysByWorkspaceId = new Map<string, string>()
  const replicasByKey = new Map<string, Workspace[]>()
  for (const workspace of workspaces) {
    const key = workspaceRepoKey(workspace.gitIdentity)
    if (!key) {
      continue
    }
    keysByWorkspaceId.set(workspace.id, key)
    const replicas = replicasByKey.get(key) ?? []
    replicas.push(workspace)
    replicasByKey.set(key, replicas)
  }

  const clusters: WorkspaceRepoCluster[] = []
  for (const [key, replicas] of replicasByKey) {
    if (replicas.length < 2) {
      continue
    }
    clusters.push({
      key,
      name: shortestName(replicas.map(replica => replica.name)),
      replicas,
    })
  }

  // Mark every clustered workspace so it is not rendered twice.
  const clusteredWorkspaceIds = new Set<string>()
  for (const cluster of clusters) {
    cluster.replicas.sort(compareReplicas)
    for (const replica of cluster.replicas) {
      clusteredWorkspaceIds.add(replica.id)
    }
  }

  return {
    clusters: clusters.sort((left, right) => left.name.localeCompare(right.name)),
    workspacesWithoutCluster: workspaces.filter(
      workspace => !clusteredWorkspaceIds.has(workspace.id),
    ),
  }
}

function shortestName(names: readonly string[]): string {
  return [...names].sort((left, right) =>
    left.length - right.length || left.localeCompare(right))[0] ?? ''
}

function compareReplicas(left: Workspace, right: Workspace): number {
  const pinDiff = (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0)
  if (pinDiff !== 0) {
    return pinDiff
  }
  return left.name.localeCompare(right.name)
}

/**
 * One not-yet-mounted copy of a clustered repository discovered on a remote
 * machine. Surfaced as a shadow row with a one-click mount action.
 */
export interface RepoWorkspaceShadow {
  nodeId: string
  nodeName: string
  path: string
  sourceWorkspaceId?: string | null
  kind?: 'project' | 'managed-worktree'
}

/**
 * Find remote, not-yet-mounted copies of the given repo keys across all Node
 * inventories. Reuses the add-dialog's inventory merging so both surfaces make
 * identical matching decisions.
 */
export function findRepoShadows(
  inventories: readonly {
    node: { nodeId: string, nodeName: string }
    workspaces: readonly {
      id: string
name: string
path: string
      kind?: 'project' | 'managed-worktree'
      originUrl?: string | null
repoRoot?: string | null
    }[]
  }[],
  addedLocators: readonly { nodeId: string, path: string }[],
): Map<string, RepoWorkspaceShadow[]> {
  const entries: NodeWorkspaceEntry[] = mergeNodeWorkspaceInventories(
    inventories.map(inventory => ({
      node: inventory.node,
      workspaces: inventory.workspaces,
    })),
    addedLocators,
  )
  const shadowsByKey = new Map<string, RepoWorkspaceShadow[]>()
  for (const entry of entries) {
    const shadows: RepoWorkspaceShadow[] = entry.targets
      .filter((target: NodeWorkspaceTarget) => !target.alreadyAdded)
      .map(target => ({
        nodeId: target.nodeId,
        nodeName: target.nodeName,
        path: target.path,
        sourceWorkspaceId: target.sourceWorkspaceId ?? null,
        ...(target.kind ? { kind: target.kind } : {}),
      }))
    if (shadows.length > 0 && shadowsByKey.get(entry.key) === undefined) {
      shadowsByKey.set(entry.key, shadows)
    }
  }
  return shadowsByKey
}

export { repoDisplayNameFromKey }
