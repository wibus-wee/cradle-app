// Lifecycle: PTY runs in the server independently of this component.
// On mount: call startOrAttach (starts new or reuses existing), then connect PTY socket.
//           Buffer replay comes via the socket snapshot event.
// On unmount: dispose xterm instance and close the socket — PTY keeps running.
// PTY is only stopped when the session is explicitly deleted.

import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'

import { postTerminalSessionsBySessionIdStartOrAttach } from '~/api-gen'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'

import { getAppTerminalTheme, watchTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'
import { createPtyChannel } from './pty-channel'
import { getTerminalFontFamily } from './terminal-font'
import { useTerminalPreferencesStore } from './terminal-preferences'

const EXIT_BANNER = '\r\n\x1B[2m[Process exited]\x1B[0m\r\n'

interface TuiViewProps {
  sessionId: string
  visible?: boolean
}

export function TuiView({ sessionId, visible: _visible = true }: TuiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<ReturnType<typeof createPtyChannel> | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    setReady(false)

    const terminal = new Terminal({
      theme: getAppTerminalTheme(),
      fontFamily: getTerminalFontFamily(useTerminalPreferencesStore.getState().fontFamily),
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    // Try WebGL renderer
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      terminal.loadAddon(webgl)
    }
    catch { /* WebGL unavailable — xterm falls back to canvas */ }

    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let fontFrame: number | null = null
    let pendingCols = 0
    let pendingRows = 0

    // Declared here so applyResize can reference it; assigned after createPtyChannel below.
    let channel: ReturnType<typeof createPtyChannel>

    function applyResize(cols: number, rows: number) {
      if (cols <= 0 || rows <= 0) {
        return
      }
      pendingCols = cols
      pendingRows = rows
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (pendingCols === lastCols && pendingRows === lastRows) {
          return
        }
        terminal.resize(pendingCols, pendingRows)
        lastCols = pendingCols
        lastRows = pendingRows
        channel.sendResize(lastCols, lastRows)
      }, 100)
    }

    function refitAndNotify() {
      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        return
      }
      applyResize(dims.cols, dims.rows)
    }

    let exitShown = false

    function writeSnapshot(buffer: string, running: boolean) {
      terminal.reset()
      if (buffer) {
        terminal.write(buffer)
      }
      if (!running && !exitShown) {
        exitShown = true
        terminal.write(EXIT_BANNER)
      }
    }

    channel = createPtyChannel({
      socketPath: `/terminal-sessions/${encodeURIComponent(sessionId)}/socket`,
      onSnapshot(event) {
        writeSnapshot(event.buffer, event.running)
      },
      onOutput(event) {
        if (event.data) {
          terminal.write(event.data)
        }
      },
      onExit() {
        if (exitShown) {
          return
        }
        exitShown = true
        terminal.write(EXIT_BANNER)
      },
    })
    channelRef.current = channel

    void (async () => {
      // Start or attach to terminal, then connect the live channel.
      const dims = fitAddon.proposeDimensions()
      const cols = dims && dims.cols > 0 ? dims.cols : 80
      const rows = dims && dims.rows > 0 ? dims.rows : 24
      terminal.resize(cols, rows)
      lastCols = cols
      lastRows = rows

      await postTerminalSessionsBySessionIdStartOrAttach({
        path: { sessionId },
        body: { cols, rows },
      })

      channel.connect()
      setReady(true)
    })()

    attachMacKeyboardHandler(terminal)

    const stopWatchingTheme = watchTerminalTheme(() => {
      terminal.options.theme = getAppTerminalTheme()
      const nextFontFamily = getTerminalFontFamily(useTerminalPreferencesStore.getState().fontFamily)
      if (nextFontFamily === terminal.options.fontFamily) {
        return
      }
      terminal.options.fontFamily = nextFontFamily
      if (fontFrame !== null) {
        cancelAnimationFrame(fontFrame)
      }
      fontFrame = requestAnimationFrame(() => {
        fontFrame = null
        refitAndNotify()
      })
    })

    const stopWatchingTerminalPreferences = useTerminalPreferencesStore.subscribe((state, previousState) => {
      const nextFontFamily = getTerminalFontFamily(state.fontFamily)
      if (nextFontFamily === getTerminalFontFamily(previousState.fontFamily)) {
        return
      }

      terminal.options.fontFamily = nextFontFamily
      if (fontFrame !== null) {
        cancelAnimationFrame(fontFrame)
      }
      fontFrame = requestAnimationFrame(() => {
        fontFrame = null
        refitAndNotify()
      })
    })

    // Forward keystrokes to the server
    const dataDisposable = terminal.onData((data) => {
      channel.sendInput(data)
    })

    // Resize observer: refit on container size change
    const resizeObserver = new ResizeObserver(() => {
      refitAndNotify()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      if (fontFrame !== null) {
        cancelAnimationFrame(fontFrame)
      }
      channelRef.current = null
      channel.close()
      dataDisposable.dispose()
      resizeObserver.disconnect()
      stopWatchingTheme()
      stopWatchingTerminalPreferences()
      terminal.dispose()
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      data-testid="tui-view"
      data-tui-view-ready={ready ? 'true' : 'false'}
      data-tui-session-id={sessionId}
      style={{ padding: '4px 8px' }}
      onDrop={(e) => {
        e.preventDefault()
        const path = readWorkspaceFileDragText(e.dataTransfer)
        if (path) {
          channelRef.current?.sendInput(`${path} `)
        }
      }}
      onDragOver={e => e.preventDefault()}
    />
  )
}
