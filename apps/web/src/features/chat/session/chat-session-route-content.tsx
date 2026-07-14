import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo } from 'react'

import {
  getSessionsByIdOptions,
  getWorkspacesByWorkspaceIdOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import {
  runtimeComposerUsesCollapsedInput,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import { getLocalWorkspacePath } from '~/features/workspace/types'
import { isElectron, nativeIpc } from '~/lib/electron'
import { closeSurfaceById } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { chatSurfaceId } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'

import { ChatSessionFrameHost } from './chat-session-frame-host'
import { CHAT_SESSION_FALLBACK_LABEL } from './chat-session-label'
import { getRemoteHostId } from './session-execution'
import { readSessionThinkingEffort } from './session-thinking-effort'

function loadTerminalPanelView() {
  return import('~/features/tui/bottom-terminal-panel').then(module => ({ default: module.BottomTerminalPanel }))
}

function loadTuiView() {
  return import('~/features/tui/tui-view').then(module => ({ default: module.TuiView }))
}

const BottomTerminalPanel = lazy(loadTerminalPanelView)
const TuiView = lazy(loadTuiView)

function ChatSessionLayoutSlots({
  sessionId,
  slotId,
  ownerId,
  workspaceId,
  workspacePath,
}: {
  sessionId: string
  slotId: string
  ownerId: string
  workspaceId: string | null
  workspacePath: string | null
}) {
  'use no memo'

  const hasWorkspace = !!(workspaceId && workspacePath)

  const panel = useMemo(
    () => hasWorkspace
      ? (
          <Suspense fallback={null}>
            <BottomTerminalPanel
              ownerId={ownerId}
              cwd={workspacePath!}
            />
          </Suspense>
        )
      : undefined,
    [hasWorkspace, ownerId, workspacePath],
  )

  useRegisterLayoutSlots(slotId, useMemo(() => ({
    asideSessionId: sessionId,
    asideWorkspaceId: hasWorkspace ? workspaceId : null,
    hasAside: true,
    hasBrowserPanel: hasWorkspace,
    hasPanel: hasWorkspace,
    panel,
  }), [hasWorkspace, panel, sessionId, workspaceId]))

  return null
}

export function ChatSessionRouteContent({
  sessionId,
  onTitleChange,
  surfaceId: explicitSurfaceId,
  layoutSlotId,
}: {
  sessionId: string
  /** Notified whenever the resolved session title changes (e.g. to drive a dockview pane tab label). */
  onTitleChange?: (title: string) => void
  surfaceId?: string
  layoutSlotId?: string
}) {
  'use no memo'

  const active = useSurfaceActive()
  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const surfaceId = explicitSurfaceId ?? chatSurfaceId(sessionId)
  const slotId = layoutSlotId ?? sessionId

  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    enabled: !!sessionId,
  })
  const hasLoadedSession = !!session
  const sessionTitle = session?.title ?? null
  const sessionProviderTargetId = session?.providerTargetId ?? null
  const sessionModelId = session?.modelId ?? null
  const sessionThinkingEffort = readSessionThinkingEffort(session?.thinkingEffort)
  const { runtimes } = useRuntimeCatalog()
  const sessionRuntime = useMemo(
    () => runtimes.find(runtime => runtime.runtimeKind === session?.runtimeKind) ?? null,
    [runtimes, session?.runtimeKind],
  )
  const usesCollapsedRuntimeView = session?.runtimeKind === 'cli-tui' || (sessionRuntime
    ? runtimeComposerUsesCollapsedInput(sessionRuntime.composer)
    : false)

  useEffect(() => {
    if (typeof session?.archivedAt !== 'number') {
      return
    }

    closeSurfaceById(surfaceId)

    if (isElectron) {
      void nativeIpc?.window.closeSurface(surfaceId).catch(() => {})
    }
  }, [session?.archivedAt, sessionId, surfaceId])

  useEffect(() => {
    if (!hasLoadedSession) {
      return
    }
    const title = sessionTitle || CHAT_SESSION_FALLBACK_LABEL
    updateSurfaceTitle(surfaceId, title)
    onTitleChange?.(title)
  }, [hasLoadedSession, sessionTitle, surfaceId, updateSurfaceTitle, onTitleChange])

  const workspaceId = session?.workspaceId ?? null
  const agentId = session?.agentId ?? null
  const remoteHostId = getRemoteHostId(session)
  const activeSession = useMemo(() => ({
    sessionId,
    sessionProviderTargetId,
    sessionModelId,
    sessionThinkingEffort,
    runtimeKind: session?.runtimeKind,
    workspaceId,
    agentId,
    remoteHostId,
  }), [agentId, remoteHostId, session?.runtimeKind, sessionId, sessionModelId, sessionProviderTargetId, sessionThinkingEffort, workspaceId])

  const { data: workspace } = useQuery({
    ...getWorkspacesByWorkspaceIdOptions({ path: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
    staleTime: 60_000,
  })

  const workspacePath = getLocalWorkspacePath(workspace)

  useEffect(() => {
    if (workspacePath) {
      void loadTerminalPanelView()
    }
  }, [workspacePath])

  useEffect(() => {
    if (usesCollapsedRuntimeView) {
      void loadTuiView()
    }
  }, [usesCollapsedRuntimeView])

  if (usesCollapsedRuntimeView) {
    return (
      <>
        <ChatSessionLayoutSlots
          sessionId={sessionId}
          slotId={slotId}
          ownerId={surfaceId}
          workspaceId={workspaceId}
          workspacePath={workspacePath}
        />
        <Suspense fallback={null}>
          <TuiView sessionId={sessionId} visible={active} />
        </Suspense>
      </>
    )
  }

  return (
    <>
      <ChatSessionLayoutSlots
        sessionId={sessionId}
        slotId={slotId}
        ownerId={surfaceId}
        workspaceId={workspaceId}
        workspacePath={workspacePath}
      />
      <ChatSessionFrameHost activeSession={activeSession} active={active} />
    </>
  )
}
