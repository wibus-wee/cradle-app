import { StopCircleLine as StopIcon } from '@mingcute/react'
import { useLayoutEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'

import type { PtyActivityState } from './pty-protocol'
import { getTerminalLifetimeController } from './terminal-lifetime-controller'
import { tuiRuntimeRegistry } from './tui-runtime-registry'

interface TuiViewProps {
  sessionId: string
  visible?: boolean
}

/**
 * Main-surface CLI TUI viewport.
 *
 * The xterm runtime lives in tuiRuntimeRegistry, independently from this React mount.
 * Surface changes park the runtime instead of disposing it, preserving the terminal's
 * renderer, selection, scrollback, socket, and CLI process while the surface is hidden.
 * Closing the surface releases the renderer view but leaves the server-owned CLI PTY
 * available for a later live attach.
 */
export function TuiView({ sessionId, visible = true }: TuiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [activity, setActivity] = useState<PtyActivityState>('unknown')
  const [stopping, setStopping] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const lifetime = getTerminalLifetimeController()
    lifetime.register({
      terminalId: sessionId,
      adapterKind: 'cli-tui',
      ownerId: `chat:${sessionId}`,
    })
    lifetime.attach(sessionId)
    tuiRuntimeRegistry.attach(sessionId, container, false, setReady, setActivity)
    return () => {
      lifetime.park(sessionId)
      tuiRuntimeRegistry.detach(sessionId, container, setReady, setActivity)
    }
  }, [sessionId])

  useLayoutEffect(() => {
    tuiRuntimeRegistry.setVisible(sessionId, visible)
  }, [sessionId, visible])

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-background"
      onDrop={(event) => {
        event.preventDefault()
        const path = readWorkspaceFileDragText(event.dataTransfer)
        if (path && visible) {
          tuiRuntimeRegistry.sendInput(sessionId, `${path} `)
        }
      }}
      onDragOver={(event) => {
        if (visible) {
          event.preventDefault()
        }
      }}
    >
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        data-testid="tui-view"
        data-tui-view-ready={ready ? 'true' : 'false'}
        data-tui-session-id={sessionId}
        data-tui-visible={visible ? 'true' : 'false'}
        aria-hidden={visible ? undefined : 'true'}
      />
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border/60 bg-background/90 p-1 shadow-sm">
        <span
          className={`size-2 rounded-full ${activity === 'working' ? 'bg-amber-500' : activity === 'blocked' ? 'bg-red-500' : activity === 'idle' ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
          title={`CLI ${activity}`}
          aria-label={`CLI status: ${activity}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="pointer-events-auto text-muted-foreground hover:text-destructive"
          aria-label="Stop CLI session"
          title="Stop CLI session"
          disabled={stopping}
          onClick={() => {
            setStopping(true)
            void getTerminalLifetimeController().stop(sessionId).catch(() => {}).finally(() => {
              setStopping(false)
            })
          }}
        >
          <StopIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
