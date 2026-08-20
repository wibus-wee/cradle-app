import type { WorkSummary } from '~/features/work/use-work'

import type { WorkspaceSession } from './use-session'
import {
  hasUnreadWorkspaceSessionError,
  isWorkspaceSessionRunning,
} from './workspace-session-status'
import type {
  WorkspaceSidebarEnvironmentFilter,
  WorkspaceSidebarListFilters,
  WorkspaceSidebarSourceFilter,
  WorkspaceSidebarStatusFilter,
  WorkspaceSidebarWorkPrFilter,
} from './workspace-sidebar-ui-store'
import { rowFiltersAreActive } from './workspace-sidebar-ui-store'

export type WorkspaceSidebarSessionAttention = 'userInput' | 'toolApproval'

export function classifyWorkspaceSidebarSource(
  origin: string | null | undefined,
): WorkspaceSidebarSourceFilter {
  switch (origin) {
    case 'work':
      return 'work'
    case 'automation':
      return 'automation'
    case 'cradle-review':
      return 'review'
    default:
      return 'chat'
  }
}

function workPullRequestKind(
  work: WorkSummary | null | undefined,
): 'draft' | 'ready' | 'merged' | null {
  const pullRequest = work?.pullRequest
  if (!pullRequest) {
    return null
  }
  if (pullRequest.merged) {
    return 'merged'
  }
  if (pullRequest.isDraft) {
    return 'draft'
  }
  if (pullRequest.state === 'open') {
    return 'ready'
  }
  return null
}

function matchesStatusFilters(
  session: WorkspaceSession,
  work: WorkSummary | null | undefined,
  filters: readonly WorkspaceSidebarStatusFilter[],
  locallyStreamingSessionIds: ReadonlySet<string>,
  locallyErroredSessionIds: ReadonlySet<string>,
  attentionBySessionId: ReadonlyMap<string, WorkspaceSidebarSessionAttention>,
): boolean {
  if (filters.length === 0) {
    return true
  }

  return filters.some((filter) => {
    switch (filter) {
      case 'unread':
        return session.unread
      case 'streaming':
        return isWorkspaceSessionRunning(session, locallyStreamingSessionIds)
      case 'error':
        return hasUnreadWorkspaceSessionError(session, locallyErroredSessionIds)
      case 'needsYou':
        return attentionBySessionId.has(session.id)
          || work?.activity === 'waiting'
          || work?.activity === 'blocked'
    }
    return false
  })
}

function matchesWorkPrFilters(
  session: WorkspaceSession,
  work: WorkSummary | null | undefined,
  filters: readonly WorkspaceSidebarWorkPrFilter[],
): boolean {
  if (filters.length === 0) {
    return true
  }

  const prKind = workPullRequestKind(work)
  return filters.some((filter) => {
    switch (filter) {
      case 'work':
        return work != null || session.origin === 'work'
      case 'draft':
        return prKind === 'draft'
      case 'ready':
        return prKind === 'ready'
      case 'merged':
        return prKind === 'merged'
    }
    return false
  })
}

function matchesSourceFilters(
  session: WorkspaceSession,
  filters: readonly WorkspaceSidebarSourceFilter[],
): boolean {
  if (filters.length === 0) {
    return true
  }
  const source = classifyWorkspaceSidebarSource(session.origin)
  return filters.includes(source)
}

export function classifyWorkspaceSidebarEnvironment(
  session: WorkspaceSession,
): WorkspaceSidebarEnvironmentFilter {
  return session.execution.kind === 'remote-host' ? 'remote' : 'local'
}

function matchesEnvironmentFilters(
  session: WorkspaceSession,
  filters: readonly WorkspaceSidebarEnvironmentFilter[],
): boolean {
  if (filters.length === 0) {
    return true
  }
  return filters.includes(classifyWorkspaceSidebarEnvironment(session))
}

export function sessionMatchesListFilters(
  session: WorkspaceSession,
  work: WorkSummary | null | undefined,
  filters: WorkspaceSidebarListFilters,
  locallyStreamingSessionIds: ReadonlySet<string>,
  locallyErroredSessionIds: ReadonlySet<string>,
  attentionBySessionId: ReadonlyMap<string, WorkspaceSidebarSessionAttention>,
): boolean {
  if (!filters.showArchived && session.archivedAt !== null) {
    return false
  }

  return matchesStatusFilters(
    session,
    work,
    filters.statusFilters,
    locallyStreamingSessionIds,
    locallyErroredSessionIds,
    attentionBySessionId,
  )
  && matchesWorkPrFilters(session, work, filters.workPrFilters)
  && matchesEnvironmentFilters(session, filters.environmentFilters)
  && matchesSourceFilters(session, filters.sourceFilters)
}

export function projectMatchesListFilters(
  sessions: readonly WorkspaceSession[],
  workByPrimarySessionId: ReadonlyMap<string, WorkSummary>,
  filters: WorkspaceSidebarListFilters,
  locallyStreamingSessionIds: ReadonlySet<string>,
  locallyErroredSessionIds: ReadonlySet<string>,
  attentionBySessionId: ReadonlyMap<string, WorkspaceSidebarSessionAttention>,
): boolean {
  // Archived only changes the candidate set. Row facets decide whether a
  // project stays visible after session trimming.
  if (!rowFiltersAreActive(filters)) {
    return true
  }

  return sessions.some(session =>
    sessionMatchesListFilters(
      session,
      workByPrimarySessionId.get(session.id) ?? null,
      filters,
      locallyStreamingSessionIds,
      locallyErroredSessionIds,
      attentionBySessionId,
    ))
}
