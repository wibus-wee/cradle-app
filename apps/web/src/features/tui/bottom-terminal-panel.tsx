import {
  CloseLine as XIcon,
  PlusLine as PlusIcon,
  TerminalBoxLine as SquareTerminalIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'

import { deleteTerminalSessionsShellByPtyId } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { useLayoutStore } from '~/store/layout'

import { ShellView } from './shell-view'
import type { TerminalMetadata } from './terminal-metadata'
import { getTerminalPathLabel } from './terminal-metadata'
import { useTerminalPanelStore } from './terminal-panel-store'

interface BottomTerminalPanelProps {
  ownerId: string
  cwd: string
}

export function BottomTerminalPanel({ ownerId, cwd }: BottomTerminalPanelProps) {
  const owner = useTerminalPanelStore(state => state.owners[ownerId])
  const registerOwner = useTerminalPanelStore(state => state.registerOwner)
  const addSession = useTerminalPanelStore(state => state.addSession)
  const activateSession = useTerminalPanelStore(state => state.activateSession)
  const removeSession = useTerminalPanelStore(state => state.removeSession)
  const updateSessionTitle = useTerminalPanelStore(state => state.updateSessionTitle)
  const bottomPanelOpen = useLayoutStore(state => state.bottomPanelOpen)
  const setBottomPanelOpen = useLayoutStore(state => state.setBottomPanelOpen)
  const [cwdBySessionId, setCwdBySessionId] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!bottomPanelOpen) {
      return
    }

    registerOwner(ownerId, cwd)
  }, [bottomPanelOpen, cwd, ownerId, registerOwner])

  const sessions = owner?.sessions ?? []
  const activeSessionId = owner?.activeSessionId ?? sessions[0]?.id ?? null

  function handleAddSession() {
    addSession(ownerId, cwd)
  }

  function handleRemoveSession(sessionId: string) {
    void deleteTerminalSessionsShellByPtyId({
      path: { ptyId: sessionId },
    }).catch(() => {})
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
      setCwdBySessionId(prev => ({ ...prev, [sessionId]: metadata.cwd }))
    }
  }

  const activeSession = sessions.find(session => session.id === activeSessionId) ?? sessions[0] ?? null

  if (!activeSession) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-xs text-muted-foreground">
        Preparing terminal
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="bottom-terminal-panel">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ShellView
          key={activeSession.id}
          ptyId={activeSession.id}
          cwd={activeSession.cwd}
          visible={bottomPanelOpen}
          stopOnUnmount={false}
          onMetadata={metadata => handleMetadata(activeSession.id, metadata)}
          onExited={() => {
            const remainingCount = removeSession(ownerId, activeSession.id)
            if (remainingCount === 0) {
              setBottomPanelOpen(false)
            }
          }}
        />
      </div>
      <div className="flex w-56 shrink-0 flex-col border-l border-border/70 bg-background" data-testid="bottom-terminal-session-tabs">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 px-2">
          <span className="truncate text-[11px] font-medium text-muted-foreground">Terminals</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleAddSession}
            aria-label="New terminal session"
            title="New terminal session"
            data-testid="bottom-terminal-new-session"
          >
            <PlusIcon className="size-3" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {sessions.map((session) => {
            const selected = session.id === activeSession.id
            const pathLabel = getTerminalPathLabel(cwd, cwdBySessionId[session.id] ?? session.cwd)

            return (
              <div
                key={session.id}
                className={cn(
                  'group flex min-h-7 w-full items-center rounded-md transition-colors',
                  selected
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
                data-testid="bottom-terminal-tab"
                data-active={selected ? 'true' : 'false'}
              >
                <button
                  type="button"
                  onClick={() => activateSession(ownerId, session.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[11px]"
                >
                  <SquareTerminalIcon className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {pathLabel && (
                    <span className="max-w-18 shrink-0 truncate rounded bg-foreground/7 px-1 font-mono text-[10px] text-muted-foreground">
                      {pathLabel}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${session.title}`}
                  data-testid={`bottom-terminal-close-${session.id}`}
                  className="mr-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/10 focus:opacity-100"
                  onClick={() => handleRemoveSession(session.id)}
                >
                  <XIcon className="size-2.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
