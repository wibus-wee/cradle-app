import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getSessionsByIdExportMarkdown,
  patchSessionsById,
  postChatSessionsBySessionIdTitleRegenerate,
  postSessionsByIdArchive,
  postSessionsByIdRead,
  postSessionsByIdUnread,
  postWorksByIdArchive,
} from '~/api-gen'
import {
  getSessionsByIdQueryKey,
  getWorksByIdQueryKey,
  getWorksQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { downloadSessionZip } from '~/features/session/download-session-zip'
import type { WorkSummary } from '~/features/work/use-work'
import { isElectron, nativeIpc } from '~/lib/electron'
import {
  closeSurfaceById,
  openChatSession,
  openWork,
} from '~/navigation/navigation-commands'
import { chatSurfaceId, workSurfaceId } from '~/navigation/surface-identity'
import {
  openTearoffChatSessionWindow,
  openTearoffSurfaceWindow,
} from '~/navigation/tearoff-surfaces'
import { useTitleRegenerationStore } from '~/store/title-regeneration'

import type { WorkspaceSession } from './use-session'
import {
  sessionsQueryKey,
  updateSessionReadState,
} from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'
import type {
  WorkspaceSessionActionsMenuState,
} from './workspace-session-actions-menu-state'
import { WorkspaceSessionActionsMenuView } from './workspace-session-actions-menu-view'

export interface WorkspaceSessionActionsMenuProps {
  state: WorkspaceSessionActionsMenuState
  session: WorkspaceSession | null
  work: WorkSummary | null
  workspaceId: string
  sessionGroups: WorkspaceSessionGroup[]
  onOpenChange: (open: boolean) => void
  onPrepareSessionOpen: (session: WorkspaceSession) => void
  onStartRename: (sessionId: string) => void
  onAddSessionToGroup: (sessionId: string, groupId: string) => void
  onRemoveSessionFromGroup: (session: WorkspaceSession) => void
  onCreateSessionGroupFromSession: (session: WorkspaceSession) => void
}

function formatRegenerateTitleError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (!error || typeof error !== 'object') {
    return String(error)
  }
  const payload = error as {
    message?: unknown
    details?: {
      reason?: unknown
      providerError?: { detail?: unknown, method?: unknown }
      error?: { message?: unknown }
    }
  }
  const providerDetail
    = typeof payload.details?.providerError?.detail === 'string'
      ? payload.details.providerError.detail
      : null
  const providerMethod
    = typeof payload.details?.providerError?.method === 'string'
      ? payload.details.providerError.method
      : null
  if (providerDetail && providerMethod) {
    return `${providerMethod}: ${providerDetail}`
  }
  if (providerDetail) {
    return providerDetail
  }
  if (typeof payload.details?.error?.message === 'string') {
    return payload.details.error.message
  }
  if (typeof payload.message === 'string') {
    return payload.message
  }
  return JSON.stringify(error)
}

export function WorkspaceSessionActionsMenu({
  state,
  session,
  work,
  workspaceId,
  sessionGroups,
  onOpenChange,
  onPrepareSessionOpen,
  onStartRename,
  onAddSessionToGroup,
  onRemoveSessionFromGroup,
  onCreateSessionGroupFromSession,
}: WorkspaceSessionActionsMenuProps) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()

  const invalidateSessionQueries = useCallback(async () => {
    if (!session) {
      return
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: sessionsQueryKey(workspaceId),
      }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }),
      }),
      queryClient.invalidateQueries({ queryKey: getWorksQueryKey() }),
      ...(work
        ? [queryClient.invalidateQueries({
            queryKey: getWorksByIdQueryKey({ path: { id: work.id } }),
          })]
        : []),
    ])
  }, [queryClient, session, work, workspaceId])

  const openInSurface = useCallback(() => {
    if (!session) {
      return
    }
    if (work) {
      openWork(work.id)
      return
    }
    openChatSession(session.id)
  }, [session, work])

  const openInNewWindow = useCallback(() => {
    if (!session) {
      return
    }

    onPrepareSessionOpen(session)
    const screenX = window.screenX + Math.round(window.outerWidth / 2)
    const screenY = window.screenY + Math.round(window.outerHeight / 2)
    if (work) {
      void openTearoffSurfaceWindow({
        id: workSurfaceId(work.id),
        kind: 'work',
        title: work.title,
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
  }, [onPrepareSessionOpen, session, work])

  const startRename = useCallback(() => {
    if (!session) {
      return
    }
    onOpenChange(false)
    onStartRename(session.id)
  }, [onOpenChange, onStartRename, session])

  const regenerateTitle = useCallback(async () => {
    if (!session) {
      return
    }

    const { beginRegeneration, endRegeneration }
      = useTitleRegenerationStore.getState()
    beginRegeneration(session.id)
    try {
      const { error } = await postChatSessionsBySessionIdTitleRegenerate({
        path: { sessionId: session.id },
      })
      if (error) {
        throw error
      }
      await invalidateSessionQueries()
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('session.toast.regenerateTitleFailed'),
        description: formatRegenerateTitleError(error),
      })
    }
    finally {
      endRegeneration(session.id)
    }
  }, [invalidateSessionQueries, session, t])

  const toggleReadState = useCallback(async () => {
    if (!session) {
      return
    }

    const { data } = session.unread
      ? await postSessionsByIdRead({ path: { id: session.id } })
      : await postSessionsByIdUnread({ path: { id: session.id } })
    if (data) {
      updateSessionReadState(queryClient, data)
    }
  }, [queryClient, session])

  const togglePin = useCallback(async () => {
    if (!session) {
      return
    }

    await patchSessionsById({
      path: { id: session.id },
      body: { pinned: !session.pinned },
    })
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: sessionsQueryKey(workspaceId),
      }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
    ])
  }, [queryClient, session, workspaceId])

  const copyMarkdown = useCallback(async () => {
    if (!session) {
      return
    }

    const { data } = await getSessionsByIdExportMarkdown({
      path: { id: session.id },
    })
    const markdown = (data as { markdown?: string } | null)?.markdown
    if (markdown) {
      await navigator.clipboard.writeText(markdown)
    }
  }, [session])

  const exportZip = useCallback(async () => {
    if (!session) {
      return
    }
    try {
      await downloadSessionZip(session.id)
    }
    catch (error) {
      const code = error instanceof Error ? error.message : ''
      toastManager.add({
        type: 'error',
        title: code === 'session-export-busy'
          ? t('session.toast.exportZipBusy')
          : t('session.toast.exportZipFailed'),
      })
    }
  }, [session, t])

  const copySessionId = useCallback(async () => {
    if (session) {
      await navigator.clipboard.writeText(session.id)
    }
  }, [session])

  const archive = useCallback(async () => {
    if (!session) {
      return
    }

    if (work) {
      await postWorksByIdArchive({
        path: { id: work.id },
        body: { archived: true },
      })
    }
    else {
      await postSessionsByIdArchive({
        path: { id: session.id },
        body: { archived: true },
      })
    }

    const surfaceId = work
      ? workSurfaceId(work.id)
      : chatSurfaceId(session.id)
    closeSurfaceById(surfaceId)
    if (isElectron) {
      void nativeIpc?.window.closeSurface(surfaceId).catch(() => {})
    }
    await invalidateSessionQueries()
  }, [invalidateSessionQueries, session, work])

  return (
    <WorkspaceSessionActionsMenuView
      open={state.open}
      anchor={state.anchor}
      session={session}
      sessionGroups={sessionGroups}
      canOpenInNewWindow={isElectron}
      canCopySessionId={import.meta.env.DEV}
      onOpenChange={onOpenChange}
      onOpenInSurface={openInSurface}
      onOpenInNewWindow={openInNewWindow}
      onRename={startRename}
      onRegenerateTitle={regenerateTitle}
      onToggleReadState={toggleReadState}
      onTogglePin={togglePin}
      onCopyMarkdown={copyMarkdown}
      onExportZip={exportZip}
      onCopySessionId={copySessionId}
      onArchive={archive}
      onAddToGroup={(groupId) => {
        if (session) {
          onAddSessionToGroup(session.id, groupId)
        }
      }}
      onRemoveFromGroup={() => {
        if (session) {
          onRemoveSessionFromGroup(session)
        }
      }}
      onCreateGroup={() => {
        if (session) {
          onCreateSessionGroupFromSession(session)
        }
      }}
    />
  )
}
