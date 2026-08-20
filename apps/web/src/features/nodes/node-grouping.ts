import type { FabricNode } from './types'

/**
 * Pure grouping/derivation logic for the Nodes product surface.
 * No query/store imports — the same functions drive Stories fixtures and tests.
 */

export interface NodesSidebarGroups {
  /** The enrolled local Node (`fabric_membership.localNodeId`), if listed. */
  thisDevice: FabricNode | null
  online: FabricNode[]
  offline: FabricNode[]
}

/**
 * Sidebar ordering per Plan 076 Milestone 4: `This device` first, then online
 * Nodes, then offline Nodes. Ties within a group sort by display name.
 */
export function groupNodesForSidebar(
  nodes: readonly FabricNode[],
  localNodeId: string | null,
): NodesSidebarGroups {
  const byName = (left: FabricNode, right: FabricNode) =>
    left.displayName.localeCompare(right.displayName) || left.nodeId.localeCompare(right.nodeId)

  const groups: NodesSidebarGroups = { thisDevice: null, online: [], offline: [] }
  for (const node of nodes) {
    if (localNodeId !== null && node.nodeId === localNodeId) {
      groups.thisDevice = node
      continue
    }
    ;(node.status === 'online' ? groups.online : groups.offline).push(node)
  }
  groups.online.sort(byName)
  groups.offline.sort(byName)
  return groups
}

/** Resolve a Node display name from the cached `/nodes` list. */
export function resolveNodeDisplayName(
  nodes: readonly FabricNode[],
  nodeId: string | null | undefined,
): string | null {
  if (!nodeId) {
    return null
  }
  return nodes.find(node => node.nodeId === nodeId)?.displayName ?? null
}

/**
 * One logical workspace entry in the merged add-workspace view. The same Git
 * repository mounted on several Nodes collapses into one entry with one
 * selectable target machine per Node.
 */
export interface NodeWorkspaceTarget {
  nodeId: string
  nodeName: string
  path: string
  /** Remote workspace id on the target Node, when known. */
  sourceWorkspaceId?: string | null
  kind?: 'project' | 'managed-worktree'
  /** Already mounted locally with this exact locator. */
  alreadyAdded: boolean
}

export interface NodeWorkspaceEntry {
  /** Stable merge key: normalized origin URL, repo root, or `path@nodeId`. */
  key: string
  name: string
  originUrl: string | null
  repoRoot: string | null
  targets: NodeWorkspaceTarget[]
}

export interface NodeWorkspaceSummary {
  id: string
  name: string
  path: string
  kind?: 'project' | 'managed-worktree'
  originUrl?: string | null
  repoRoot?: string | null
}

export interface LocalWorkspaceLocation {
  nodeId: string
  path: string
}

function normalizeOriginUrl(originUrl: string | null | undefined): string | null {
  if (!originUrl) {
    return null
  }
  const trimmed = originUrl.trim()
  if (!trimmed) {
    return null
  }
  // Canonicalize `git@host:org/repo.git` and `https://host/org/repo.git` forms
  // so the same repository merges across Nodes regardless of remote syntax.
  const scpLike = /^git@([^:]+):(.+)$/.exec(trimmed)
  const normalized = (scpLike ? `https://${scpLike[1]}/${scpLike[2]}` : trimmed)
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase()
  return normalized
}

function workspaceMergeKey(summary: NodeWorkspaceSummary, nodeId: string): string {
  const origin = normalizeOriginUrl(summary.originUrl)
  if (origin) {
    return `origin:${origin}`
  }
  if (summary.repoRoot) {
    return `repo:${summary.repoRoot.toLowerCase()}`
  }
  // No Git identity: the workspace can never merge across machines.
  return `path:${nodeId}:${summary.path}`
}

/**
 * Merge per-Node workspace summaries into logical Workspace entries.
 *
 * `addedLocators` are locators already mounted in this Cradle App; a matching
 * target is flagged `alreadyAdded` so the View can disable re-adding it.
 */
export function mergeNodeWorkspaceInventories(
  inventories: readonly {
    node: { nodeId: string, nodeName: string }
    workspaces: readonly NodeWorkspaceSummary[]
  }[],
  addedLocators: readonly LocalWorkspaceLocation[],
): NodeWorkspaceEntry[] {
  const addedKeys = new Set(addedLocators.map(locator => `${locator.nodeId}:${locator.path}`))
  const entriesByKey = new Map<string, NodeWorkspaceEntry>()

  for (const { node, workspaces } of inventories) {
    for (const workspace of workspaces) {
      const key = workspaceMergeKey(workspace, node.nodeId)
      const target: NodeWorkspaceTarget = {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        path: workspace.path,
        sourceWorkspaceId: workspace.id,
        kind: workspace.kind,
        alreadyAdded: addedKeys.has(`${node.nodeId}:${workspace.path}`),
      }
      const existing = entriesByKey.get(key)
      if (existing) {
        existing.targets.push(target)
        continue
      }
      entriesByKey.set(key, {
        key,
        name: workspace.name,
        originUrl: workspace.originUrl ?? null,
        repoRoot: workspace.repoRoot ?? null,
        targets: [target],
      })
    }
  }

  return [...entriesByKey.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name) || left.key.localeCompare(right.key))
}
