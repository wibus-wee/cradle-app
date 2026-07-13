import { useEffect, useState } from 'react'

import { deleteTerminalSessionsShellByPtyId } from '~/api-gen/sdk.gen'
import { useBottomPanelVisibility } from '~/components/layout/bottom-panel-visibility'
import { useLayoutStore } from '~/store/layout'

import type { TerminalMetadata } from './terminal-metadata'
import { TerminalPaneView } from './terminal-pane-view'
import type { TerminalPanelSession } from './terminal-panel-store'
import { MAX_TERMINAL_PANES, useTerminalPanelStore } from './terminal-panel-store'

const EMPTY_SESSIONS: TerminalPanelSession[] = []

interface BottomTerminalPanelProps {
  ownerId: string
  cwd: string
}

export function BottomTerminalPanel({ ownerId, cwd }: BottomTerminalPanelProps) {
  const owner = useTerminalPanelStore(state => state.owners[ownerId])
  const registerOwner = useTerminalPanelStore(state => state.registerOwner)
  const addSession = useTerminalPanelStore(state => state.addSession)
  const splitSession = useTerminalPanelStore(state => state.splitSession)
  const activateSession = useTerminalPanelStore(state => state.activateSession)
  const removeSession = useTerminalPanelStore(state => state.removeSession)
  const resizeSplit = useTerminalPanelStore(state => state.resizeSplit)
  const updateSessionTitle = useTerminalPanelStore(state => state.updateSessionTitle)
  const bottomPanelOpen = useLayoutStore(state => state.bottomPanelOpen)
  const panelVisible = useBottomPanelVisibility()
  const setBottomPanelOpen = useLayoutStore(state => state.setBottomPanelOpen)
  const [cwdBySessionId, setCwdBySessionId] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (bottomPanelOpen) {
      registerOwner(ownerId, cwd)
    }
  }, [bottomPanelOpen, cwd, ownerId, registerOwner])

  const sessions = owner?.sessions ?? EMPTY_SESSIONS
  const sessionsById = new Map(sessions.map(session => [session.id, session]))

  function handleRemoveSession(sessionId: string, stopProcess: boolean) {
    if (stopProcess) {
      void deleteTerminalSessionsShellByPtyId({ path: { ptyId: sessionId } }).catch(() => {})
    }
    const remainingCount = removeSession(ownerId, sessionId)
    if (remainingCount === 0) {
      setBottomPanelOpen(false)
    }
  }

  function handleMetadata(sessionId: string, metadata: TerminalMetadata) {
    if (metadata.title) {
      updateSessionTitle(ownerId, sessionId, metadata.title)
    }
    if (metadata.cwd) {
      setCwdBySessionId(current => (
        current[sessionId] === metadata.cwd
          ? current
          : { ...current, [sessionId]: metadata.cwd }
      ))
    }
  }

  if (!owner?.layout || sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-xs text-muted-foreground">
        Preparing terminal
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-background" data-testid="bottom-terminal-panel">
      <TerminalPaneView
        layout={owner.layout}
        sessionsById={sessionsById}
        cwdBySessionId={cwdBySessionId}
        workspaceCwd={cwd}
        activeSessionId={owner.activeSessionId}
        panelVisible={panelVisible}
        canSplit={sessions.length < MAX_TERMINAL_PANES}
        onActivate={sessionId => activateSession(ownerId, sessionId)}
        onAddTab={() => addSession(ownerId, cwd)}
        onSplit={direction => splitSession(ownerId, cwd, direction)}
        onClose={sessionId => handleRemoveSession(sessionId, true)}
        onExited={sessionId => handleRemoveSession(sessionId, false)}
        onMetadata={handleMetadata}
        onResizeSplit={(splitId, weights) => resizeSplit(ownerId, splitId, weights)}
      />
    </div>
  )
}
