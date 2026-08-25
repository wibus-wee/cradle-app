import type { DragEvent as ReactDragEvent } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import { getSessionNodeId } from '~/features/chat/session/session-execution'
import { useNodeDisplayName } from '~/features/nodes/use-nodes'
import { writeSurfaceRouteDrag } from '~/features/split-view/dnd/split-drag-payload'
import type { WorkSummary } from '~/features/work/use-work'
import type { Workspace } from '~/features/workspace/types'
import { isElectron } from '~/lib/electron'
import { useIsActiveSurfaceId } from '~/navigation/active-surface'
import {
  openChatSession,
  openWork,
} from '~/navigation/navigation-commands'
import type { ScreenCoordinates } from '~/navigation/screen-coordinates'
import {
  getEventScreenCoordinates,
  isPointerOutsideWindow,
} from '~/navigation/screen-coordinates'
import { chatSurfaceId, workSurfaceId } from '~/navigation/surface-identity'
import {
  openTearoffChatSessionWindow,
  openTearoffSurfaceWindow,
} from '~/navigation/tearoff-surfaces'
import { useTitleRegenerationStore } from '~/store/title-regeneration'

import { usePreviewCard } from './preview-card/preview-card-context'
import { SESSION_DRAG_MIME_TYPE } from './session-drag-data'
import type { WorkspaceSession } from './use-session'
import { getSessionActivityAt, isManualSession } from './use-session'
import type {
  WorkspaceSessionAttentionKind,
  WorkspaceSessionMenuAnchor,
} from './workspace-session-item-view'
import { WorkspaceSessionItemView } from './workspace-session-item-view'
import { useWorkspaceSessionListNow } from './workspace-session-list-clock-context'

export interface WorkspaceSessionItemMenuRequest {
  sessionId: string
  workId: string | null
  anchor: WorkspaceSessionMenuAnchor
}

export interface WorkspaceSessionItemProps {
  session: WorkspaceSession
  workspace?: Workspace
  work: WorkSummary | null
  isStreaming: boolean
  attentionKind: WorkspaceSessionAttentionKind | null
  hasError: boolean
  isRenaming: boolean
  runtimeIcon: RuntimeIconDescriptor | undefined
  onPrepareSessionOpen: (session: WorkspaceSession) => void
  onPrefetchSession: (sessionId: string) => void
  onRenameCommit: (
    session: WorkspaceSession,
    nextTitle: string,
  ) => Promise<void>
  onRenameCancel: () => void
  onOpenSessionMenu: (request: WorkspaceSessionItemMenuRequest) => void
}

function formatRelativeTime(
  unixTimestamp: number,
  nowMs: number,
  t: ReturnType<typeof useTranslation<'workspace'>>['t'],
): string {
  const now = Math.floor(nowMs / 1000)
  const diff = now - unixTimestamp
  if (diff < 60) {
    return t('session.relative.now')
  }
  if (diff < 3600) {
    return t('session.relative.minutes', { count: Math.floor(diff / 60) })
  }
  if (diff < 86400) {
    return t('session.relative.hours', { count: Math.floor(diff / 3600) })
  }
  if (diff < 2592000) {
    return t('session.relative.days', { count: Math.floor(diff / 86400) })
  }
  return t('session.relative.months', { count: Math.floor(diff / 2592000) })
}

export const WorkspaceSessionItem = memo(
  ({
    session,
    workspace,
    work,
    isStreaming,
    attentionKind,
    hasError,
    isRenaming,
    runtimeIcon,
    onPrepareSessionOpen,
    onPrefetchSession,
    onRenameCommit,
    onRenameCancel,
    onOpenSessionMenu,
  }: WorkspaceSessionItemProps) => {
    const { t } = useTranslation('workspace')
    const nowMs = useWorkspaceSessionListNow()
    const nodeLabel = useNodeDisplayName(getSessionNodeId(session))
    const previewCard = usePreviewCard()
    const sessionSurfaceId = work
      ? workSurfaceId(work.id)
      : chatSurfaceId(session.id)
    const active = useIsActiveSurfaceId(sessionSurfaceId)
    const dimmed = !work && !isManualSession(session) && !active
    const isRegeneratingTitle = useTitleRegenerationStore(state =>
      state.regeneratingSessionIds.has(session.id))
    const dragScreenPointerRef = useRef<ScreenCoordinates | null>(null)
    const dragCleanupRef = useRef<(() => void) | null>(null)
    const dragWasTornOffRef = useRef(false)
    const sessionTitle = session.title?.trim()
      || work?.title
      || t('session.fallbackTitle')

    const prepareSessionOpen = useCallback(() => {
      onPrepareSessionOpen(session)
    }, [onPrepareSessionOpen, session])

    const prefetchSession = useCallback(() => {
      onPrefetchSession(session.id)
    }, [onPrefetchSession, session.id])

    const releaseSessionDrag = useCallback(() => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      dragScreenPointerRef.current = null
      dragWasTornOffRef.current = false
    }, [])

    const recordDragPosition = useCallback((event: Event) => {
      const screenPointer = getEventScreenCoordinates(event, window)
      if (
        screenPointer
        && event.type.startsWith('drag')
        && screenPointer.screenX === 0
        && screenPointer.screenY === 0
        && dragScreenPointerRef.current
      ) {
        return
      }
      if (screenPointer) {
        dragScreenPointerRef.current = screenPointer
      }
    }, [])

    const openInNewWindow = useCallback(() => {
      if (!isElectron) {
        return
      }
      prepareSessionOpen()
      const screenX = window.screenX + Math.round(window.outerWidth / 2)
      const screenY = window.screenY + Math.round(window.outerHeight / 2)
      if (work) {
        void openTearoffSurfaceWindow({
          id: workSurfaceId(work.id),
          kind: 'work',
          title: sessionTitle,
          route: { to: '/work/$workId', params: { workId: work.id } },
          order: 0,
          closable: true,
        }, { screenX, screenY, detachSurface: true })
        return
      }
      void openTearoffChatSessionWindow(session.id, {
        screenX,
        screenY,
        detachSurface: true,
      })
    }, [prepareSessionOpen, session.id, sessionTitle, work])

    const checkSessionTearOff = useCallback(() => {
      if (dragWasTornOffRef.current || !isElectron) {
        return false
      }
      const pointer = dragScreenPointerRef.current
      if (!pointer || !isPointerOutsideWindow(pointer, window)) {
        return false
      }
      dragWasTornOffRef.current = true
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      void openTearoffChatSessionWindow(session.id, {
        screenX: pointer.screenX,
        screenY: pointer.screenY,
        detachSurface: true,
      }).then((opened) => {
        if (!opened) {
          dragWasTornOffRef.current = false
        }
      })
      return true
    }, [session.id])

    const handleDragStart = useCallback((
      event: ReactDragEvent<HTMLDivElement>,
    ) => {
      event.dataTransfer.setData(SESSION_DRAG_MIME_TYPE, session.id)
      // Also advertise the full chat route so the split view treats a sidebar
      // session drag like any other surface drop; the native tear-off target
      // still reads the plain id above.
      writeSurfaceRouteDrag(event.dataTransfer, { to: '/chat/$sessionId', params: { sessionId: session.id } })
      event.dataTransfer.effectAllowed = 'move'
      recordDragPosition(event.nativeEvent)
      dragWasTornOffRef.current = false
      dragCleanupRef.current?.()
      const handleDragMove = (
        moveEvent:
          | DragEvent
          | MouseEvent
          | PointerEvent
          | TouchEvent,
      ) => recordDragPosition(moveEvent)
      window.addEventListener('dragover', handleDragMove, true)
      window.addEventListener('mousemove', handleDragMove, true)
      window.addEventListener('pointermove', handleDragMove, true)
      window.addEventListener('touchmove', handleDragMove, true)
      dragCleanupRef.current = () => {
        window.removeEventListener('dragover', handleDragMove, true)
        window.removeEventListener('mousemove', handleDragMove, true)
        window.removeEventListener('pointermove', handleDragMove, true)
        window.removeEventListener('touchmove', handleDragMove, true)
      }
    }, [recordDragPosition, session.id])

    const handleDrag = useCallback((
      event: ReactDragEvent<HTMLDivElement>,
    ) => {
      recordDragPosition(event.nativeEvent)
    }, [recordDragPosition])

    const handleDragEnd = useCallback((
      event: ReactDragEvent<HTMLDivElement>,
    ) => {
      recordDragPosition(event.nativeEvent)
      if (!dragWasTornOffRef.current) {
        checkSessionTearOff()
      }
      releaseSessionDrag()
    }, [checkSessionTearOff, recordDragPosition, releaseSessionDrag])

    useEffect(() => releaseSessionDrag, [releaseSessionDrag])

    const openSessionMenu = useCallback((
      anchor: WorkspaceSessionMenuAnchor,
    ) => {
      onOpenSessionMenu({
        sessionId: session.id,
        workId: work?.id ?? null,
        anchor,
      })
    }, [onOpenSessionMenu, session.id, work?.id])

    return (
      <WorkspaceSessionItemView
        session={session}
        workspace={workspace}
        work={work}
        active={active}
        dimmed={dimmed}
        isStreaming={isStreaming}
        attentionKind={attentionKind}
        hasError={hasError}
        isRenaming={isRenaming}
        isRegeneratingTitle={isRegeneratingTitle}
        runtimeIcon={runtimeIcon}
        relativeTime={formatRelativeTime(getSessionActivityAt(session), nowMs, t)}
        nodeLabel={nodeLabel}
        draggable={!isRenaming && !work}
        canOpenInNewWindow={isElectron}
        onOpen={() => {
          previewCard.dismiss()
          prepareSessionOpen()
          if (work) {
            openWork(work.id)
          }
          else {
            openChatSession(session.id)
          }
        }}
        onPrepareOpen={() => {
          previewCard.dismiss()
          prepareSessionOpen()
        }}
        onPrefetch={prefetchSession}
        onPreview={anchor => previewCard.show({
          kind: 'session',
          session,
          anchor,
          placement: 'right',
        })}
        onPreviewLeave={previewCard.hide}
        onOpenInNewWindow={openInNewWindow}
        onRenameCommit={nextTitle => onRenameCommit(session, nextTitle)}
        onRenameCancel={onRenameCancel}
        onOpenMenu={openSessionMenu}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
      />
    )
  },
)

WorkspaceSessionItem.displayName = 'WorkspaceSessionItem'
