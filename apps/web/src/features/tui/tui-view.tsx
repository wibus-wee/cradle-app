import { useLayoutEffect, useRef, useState } from 'react'

import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'

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
 * renderer, selection, scrollback, socket, and CLI process until the surface is closed.
 */
export function TuiView({ sessionId, visible = true }: TuiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    tuiRuntimeRegistry.attach(sessionId, container, false, setReady)
    return () => tuiRuntimeRegistry.detach(sessionId, container, setReady)
  }, [sessionId])

  useLayoutEffect(() => {
    tuiRuntimeRegistry.setVisible(sessionId, visible)
  }, [sessionId, visible])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-background"
      data-testid="tui-view"
      data-tui-view-ready={ready ? 'true' : 'false'}
      data-tui-session-id={sessionId}
      data-tui-visible={visible ? 'true' : 'false'}
      aria-hidden={visible ? undefined : 'true'}
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
    />
  )
}
