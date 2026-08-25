import type { GetNodesResponse } from '~/api-gen/types.gen'
import type { WorkSummary } from '~/features/work/use-work'

import type { Workspace } from './types'
import type { WorkspaceSession } from './use-session'
import { getSessionActivityAt } from './use-session'
import {
  hasUnreadWorkspaceSessionError,
  isWorkspaceSessionRunning,
} from './workspace-session-status'
import type { WorkspaceSidebarSessionAttention } from './workspace-sidebar-list-filters'
import { classifyWorkspaceSidebarEnvironment } from './workspace-sidebar-list-filters'
import type {
  WorkspaceSidebarGrouping,
  WorkspaceSidebarOrderingDirection,
  WorkspaceSidebarSessionOrdering,
} from './workspace-sidebar-ui-store'

export type FabricNodeSummary = GetNodesResponse[number]

export interface SidebarSessionEntry {
  session: WorkspaceSession
  workspace: Workspace
}

export type SidebarUpdatedBucket
  = | 'lastHour'
    | 'earlierToday'
    | 'yesterday'
    | 'previous7Days'
    | 'earlier'
export type SidebarStatusBucket = 'streaming' | 'needsYou' | 'error' | 'unread' | 'idle'

export type SidebarSectionLabelKey
  = | `sidebar.filter.bucket.${SidebarUpdatedBucket}`
    | `sidebar.filter.status.${SidebarStatusBucket}`
    | 'sidebar.filter.environment.local'

export interface SidebarSessionSection {
  key: string
  /** i18n key in the `workspace` namespace for built-in buckets. */
  labelKey?: SidebarSectionLabelKey
  /** Pre-resolved label for dynamic buckets (Node names). */
  label?: string
  entries: SidebarSessionEntry[]
}

export type SidebarFlatGrouping = Exclude<WorkspaceSidebarGrouping, 'workspace'>

const UPDATED_BUCKET_ORDER: readonly SidebarUpdatedBucket[] = [
  'lastHour',
  'earlierToday',
  'yesterday',
  'previous7Days',
  'earlier',
]

const STATUS_BUCKET_ORDER: readonly SidebarStatusBucket[] = [
  'streaming',
  'needsYou',
  'error',
  'unread',
  'idle',
]

const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Buckets a Unix-seconds activity timestamp by local calendar day distance from `now`. */
export function classifyUpdatedBucket(activityAtSeconds: number, now: number): SidebarUpdatedBucket {
  const activityAtMs = activityAtSeconds * 1000
  const dayDistance = Math.round((startOfLocalDay(now) - startOfLocalDay(activityAtMs)) / DAY_MS)
  if (dayDistance <= 0) {
    return now - activityAtMs < 60 * 60 * 1000 ? 'lastHour' : 'earlierToday'
  }
  if (dayDistance === 1) {
    return 'yesterday'
  }
  if (dayDistance <= 7) {
    return 'previous7Days'
  }
  return 'earlier'
}

/** A session only lands in its highest-priority bucket. */
export function classifyStatusBucket(
  session: WorkspaceSession,
  work: WorkSummary | null | undefined,
  locallyStreamingSessionIds: ReadonlySet<string>,
  locallyErroredSessionIds: ReadonlySet<string>,
  attentionBySessionId: ReadonlyMap<string, WorkspaceSidebarSessionAttention>,
): SidebarStatusBucket {
  if (isWorkspaceSessionRunning(session, locallyStreamingSessionIds)) {
    return 'streaming'
  }
  if (
    attentionBySessionId.has(session.id)
    || work?.activity === 'waiting'
    || work?.activity === 'blocked'
  ) {
    return 'needsYou'
  }
  if (hasUnreadWorkspaceSessionError(session, locallyErroredSessionIds)) {
    return 'error'
  }
  if (session.unread) {
    return 'unread'
  }
  return 'idle'
}

/** Pinned sessions always come first; the rest follow the ordering key. */
export function compareSidebarSessions(
  left: WorkspaceSession,
  right: WorkspaceSession,
  ordering: WorkspaceSidebarSessionOrdering,
  direction: WorkspaceSidebarOrderingDirection,
): number {
  const pinDiff = right.pinned - left.pinned
  if (pinDiff !== 0) {
    return pinDiff
  }

  const orderingValue = (session: WorkspaceSession) =>
    ordering === 'created' ? session.createdAt : getSessionActivityAt(session)
  const keyDiff = orderingValue(right) - orderingValue(left)
  const directedKeyDiff = direction === 'desc' ? keyDiff : -keyDiff
  if (directedKeyDiff !== 0) {
    return directedKeyDiff
  }

  const titleDiff = (left.title ?? '').localeCompare(right.title ?? '')
  return titleDiff !== 0 ? titleDiff : left.id.localeCompare(right.id)
}

export function sortSidebarSessionEntries(
  entries: readonly SidebarSessionEntry[],
  ordering: WorkspaceSidebarSessionOrdering,
  direction: WorkspaceSidebarOrderingDirection,
): SidebarSessionEntry[] {
  return entries.toSorted((left, right) =>
    compareSidebarSessions(left.session, right.session, ordering, direction))
}

export interface GroupSidebarSessionsInput {
  entries: readonly SidebarSessionEntry[]
  grouping: SidebarFlatGrouping
  ordering: WorkspaceSidebarSessionOrdering
  orderingDirection: WorkspaceSidebarOrderingDirection
  workByPrimarySessionId: ReadonlyMap<string, WorkSummary>
  locallyStreamingSessionIds: ReadonlySet<string>
  locallyErroredSessionIds: ReadonlySet<string>
  attentionBySessionId: ReadonlyMap<string, WorkspaceSidebarSessionAttention>
  nodes: readonly FabricNodeSummary[]
  /** Injectable clock for tests; defaults to `Date.now()`. */
  now?: number
}

export function groupSidebarSessions(input: GroupSidebarSessionsInput): SidebarSessionSection[] {
  const sortEntries = (entries: readonly SidebarSessionEntry[]) =>
    sortSidebarSessionEntries(entries, input.ordering, input.orderingDirection)

  switch (input.grouping) {
    case 'updated': {
      const now = input.now ?? Date.now()
      const byBucket = new Map<SidebarUpdatedBucket, SidebarSessionEntry[]>()
      for (const entry of input.entries) {
        const bucket = classifyUpdatedBucket(getSessionActivityAt(entry.session), now)
        const bucketEntries = byBucket.get(bucket)
        if (bucketEntries) {
          bucketEntries.push(entry)
        }
        else {
          byBucket.set(bucket, [entry])
        }
      }
      return UPDATED_BUCKET_ORDER.flatMap((bucket) => {
        const bucketEntries = byBucket.get(bucket)
        return bucketEntries
          ? [{
              key: `updated:${bucket}`,
              labelKey: `sidebar.filter.bucket.${bucket}`,
              entries: sortEntries(bucketEntries),
            }]
          : []
      })
    }
    case 'status': {
      const byBucket = new Map<SidebarStatusBucket, SidebarSessionEntry[]>()
      for (const entry of input.entries) {
        const bucket = classifyStatusBucket(
          entry.session,
          input.workByPrimarySessionId.get(entry.session.id) ?? null,
          input.locallyStreamingSessionIds,
          input.locallyErroredSessionIds,
          input.attentionBySessionId,
        )
        const bucketEntries = byBucket.get(bucket)
        if (bucketEntries) {
          bucketEntries.push(entry)
        }
        else {
          byBucket.set(bucket, [entry])
        }
      }
      return STATUS_BUCKET_ORDER.flatMap((bucket) => {
        const bucketEntries = byBucket.get(bucket)
        return bucketEntries
          ? [{
              key: `status:${bucket}`,
              labelKey: `sidebar.filter.status.${bucket}`,
              entries: sortEntries(bucketEntries),
            }]
          : []
      })
    }
    case 'environment': {
      const nodeNameById = new Map(input.nodes.map(node => [node.nodeId, node.displayName]))
      const localEntries: SidebarSessionEntry[] = []
      const entriesByNodeId = new Map<string, SidebarSessionEntry[]>()
      for (const entry of input.entries) {
        if (classifyWorkspaceSidebarEnvironment(entry.session) === 'local') {
          localEntries.push(entry)
          continue
        }
        const execution = entry.session.execution
        const nodeId = execution.kind === 'node' ? execution.nodeId : ''
        const nodeEntries = entriesByNodeId.get(nodeId)
        if (nodeEntries) {
          nodeEntries.push(entry)
        }
        else {
          entriesByNodeId.set(nodeId, [entry])
        }
      }

      const sections: SidebarSessionSection[] = []
      if (localEntries.length > 0) {
        sections.push({
          key: 'environment:local',
          labelKey: 'sidebar.filter.environment.local',
          entries: sortEntries(localEntries),
        })
      }
      const nodeIds = [...entriesByNodeId.keys()].toSorted((left, right) =>
        (nodeNameById.get(left) ?? left).localeCompare(nodeNameById.get(right) ?? right))
      for (const nodeId of nodeIds) {
        sections.push({
          key: `environment:node:${nodeId}`,
          label: nodeNameById.get(nodeId) ?? nodeId,
          entries: sortEntries(entriesByNodeId.get(nodeId) ?? []),
        })
      }
      return sections
    }
  }
}

/**
 * Preview keeps at least `previewLimit` rows, extended so pinned and running
 * sessions are never hidden behind the collapse toggle.
 */
export function computeSectionPreviewCount(
  entries: readonly SidebarSessionEntry[],
  previewLimit: number,
  locallyStreamingSessionIds: ReadonlySet<string>,
): number {
  let highestRequiredIndex = -1
  for (const [index, { session }] of entries.entries()) {
    if (session.pinned || isWorkspaceSessionRunning(session, locallyStreamingSessionIds)) {
      highestRequiredIndex = index
    }
  }
  return Math.max(previewLimit, highestRequiredIndex + 1)
}
