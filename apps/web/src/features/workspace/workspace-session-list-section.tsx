import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { WorkSummary } from '~/features/work/use-work'

import type { WorkspaceSession } from './use-session'
import type {
  WorkspaceSessionItemMenuRequest,
} from './workspace-session-item'
import { WorkspaceSessionItem } from './workspace-session-item'
import type { WorkspaceSessionAttentionKind } from './workspace-session-item-view'
import { WorkspaceSessionListView } from './workspace-session-list-view'
import { isWorkspaceSessionRunning } from './workspace-session-status'
import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'

const SESSION_REVEAL_BATCH_SIZE = 64
const SESSION_REVEAL_DELAY_MS = 16

export type WorkspaceRuntimeIconByKind = ReadonlyMap<
  RuntimeKind,
  RuntimeIconDescriptor
>

export interface WorkspaceSessionListSectionProps {
  workspaceId: string
  sortedSessions: WorkspaceSession[]
  workByPrimarySessionId: ReadonlyMap<string, WorkSummary>
  renamingSessionId: string | null
  retainedSessionIds: ReadonlySet<string>
  locallyStreamingSessionIds: ReadonlySet<string>
  sessionAttentionBySessionId: ReadonlyMap<
    string,
    WorkspaceSessionAttentionKind
  >
  locallyErroredSessionIds: ReadonlySet<string>
  runtimeIconByKind: WorkspaceRuntimeIconByKind
  onPrepareSessionOpen: (session: WorkspaceSession) => void
  onPrefetchSession: (sessionId: string) => void
  onRenameCommit: (
    session: WorkspaceSession,
    nextTitle: string,
  ) => Promise<void>
  onRenameCancel: () => void
  onOpenSessionMenu: (request: WorkspaceSessionItemMenuRequest) => void
}

export function WorkspaceSessionListSection({
  workspaceId,
  sortedSessions,
  workByPrimarySessionId,
  renamingSessionId,
  retainedSessionIds,
  locallyStreamingSessionIds,
  sessionAttentionBySessionId,
  locallyErroredSessionIds,
  runtimeIconByKind,
  onPrepareSessionOpen,
  onPrefetchSession,
  onRenameCommit,
  onRenameCancel,
  onOpenSessionMenu,
}: WorkspaceSessionListSectionProps) {
  'use no memo'

  const sessionListExpanded = useWorkspaceSidebarUiStore(
    state => state.expandedSessionListWorkspaceIds[workspaceId] === true,
  )
  const setWorkspaceSessionListExpanded = useWorkspaceSidebarUiStore(
    state => state.setWorkspaceSessionListExpanded,
  )
  const sessionPreviewLimit = useWorkspaceSidebarUiStore(
    state => state.sessionPreviewLimit,
  )
  const [expandedSessionRenderCount, setExpandedSessionRenderCount]
    = useState(sessionPreviewLimit)
  const requiredPreviewCount = useMemo(() => {
    let highestRequiredIndex = -1
    for (const [index, session] of sortedSessions.entries()) {
      if (
        session.pinned
        || isWorkspaceSessionRunning(session, locallyStreamingSessionIds)
        || retainedSessionIds.has(session.id)
      ) {
        highestRequiredIndex = index
      }
    }
    return highestRequiredIndex + 1
  }, [locallyStreamingSessionIds, retainedSessionIds, sortedSessions])
  const collapsedSessionPreviewLimit = Math.max(
    sessionPreviewLimit,
    requiredPreviewCount,
  )
  const hiddenSessionCount = Math.max(
    sortedSessions.length - collapsedSessionPreviewLimit,
    0,
  )
  const renderedSessionCount = sessionListExpanded
    ? Math.min(
        Math.max(
          expandedSessionRenderCount,
          collapsedSessionPreviewLimit,
        ),
        sortedSessions.length,
      )
    : collapsedSessionPreviewLimit
  const visibleSessions = useMemo(
    () => sortedSessions.slice(0, renderedSessionCount),
    [renderedSessionCount, sortedSessions],
  )

  useEffect(() => {
    if (!sessionListExpanded) {
      setExpandedSessionRenderCount(current =>
        current === collapsedSessionPreviewLimit
          ? current
          : collapsedSessionPreviewLimit)
      return
    }

    if (expandedSessionRenderCount >= sortedSessions.length) {
      return
    }

    const timeout = window.setTimeout(() => {
      startTransition(() => {
        setExpandedSessionRenderCount(current =>
          Math.min(
            Math.max(current, collapsedSessionPreviewLimit)
            + SESSION_REVEAL_BATCH_SIZE,
            sortedSessions.length,
          ))
      })
    }, SESSION_REVEAL_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [
    collapsedSessionPreviewLimit,
    expandedSessionRenderCount,
    sessionListExpanded,
    sortedSessions.length,
  ])

  const toggleSessionListExpanded = useCallback(() => {
    setWorkspaceSessionListExpanded(workspaceId, !sessionListExpanded)
  }, [
    sessionListExpanded,
    setWorkspaceSessionListExpanded,
    workspaceId,
  ])

  return (
    <WorkspaceSessionListView
      workspaceId={workspaceId}
      sessionCount={sortedSessions.length}
      expanded={sessionListExpanded}
      hiddenSessionCount={hiddenSessionCount}
      onToggleExpanded={toggleSessionListExpanded}
    >
      {visibleSessions.map((session) => {
        const isStreaming = isWorkspaceSessionRunning(
          session,
          locallyStreamingSessionIds,
        )
        return (
          <WorkspaceSessionItem
            key={session.id}
            session={session}
            work={workByPrimarySessionId.get(session.id) ?? null}
            isStreaming={isStreaming}
            attentionKind={
              sessionAttentionBySessionId.get(session.id) ?? null
            }
            hasError={
              !isStreaming
              && (
                session.status === 'error'
                || locallyErroredSessionIds.has(session.id)
              )
            }
            isRenaming={session.id === renamingSessionId}
            runtimeIcon={runtimeIconByKind.get(session.runtimeKind)}
            onPrepareSessionOpen={onPrepareSessionOpen}
            onPrefetchSession={onPrefetchSession}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onOpenSessionMenu={onOpenSessionMenu}
          />
        )
      })}
    </WorkspaceSessionListView>
  )
}
