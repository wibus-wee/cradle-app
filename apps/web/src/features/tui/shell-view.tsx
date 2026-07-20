import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { postTerminalSessionsShellStart } from '~/api-gen/sdk.gen'

import { getAppTerminalTheme, watchTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'
import { createPtyChannel } from './pty-channel'
import { installTerminalAddons } from './terminal-addons'
import { getTerminalFontFamily } from './terminal-font'
import { getTerminalLifetimeController } from './terminal-lifetime-controller'
import type { TerminalMetadata } from './terminal-metadata'
import { mergeTerminalMetadata, readTerminalMetadata } from './terminal-metadata'
import { useTerminalPreferencesStore } from './terminal-preferences'

const EXIT_BANNER = '\r\n\x1B[2m[Process exited]\x1B[0m\r\n'
const MAX_TRANSCRIPT_CHARS = 8_000
const MAX_OSC_LOOKBEHIND_CHARS = 1_000

const RE_OSC = /\u001B\][^\u0007]*(\u0007|\u001B\\)/g
// eslint-disable-next-line regexp/no-obscure-range
const RE_CSI = /\u001B\[[0-?]*[ -/]*[@-~]/g
const RE_CR = /\r/g

const RE_BS = /\u0008/g
function toPlainTerminalText(value: string): string {
  return value
    .replace(RE_OSC, '')
    .replace(RE_CSI, '')
    .replace(RE_CR, '')
    .replace(RE_BS, '')
}

interface ShellViewProps {
  /** Stable ID for this shell PTY. */
  ptyId: string
  /** Working directory for the shell. Must be an absolute path. */
  cwd: string
  /** Whether this terminal is the selected panel tab. Hidden terminals stay mounted. */
  visible?: boolean
  /** Called when the shell process exits, so the parent can reset the key. */
  onExited?: () => void
  /** Called when OSC title/path metadata is observed in the terminal stream. */
  onMetadata?: (metadata: TerminalMetadata) => void
}

export function ShellView({ ptyId, cwd, visible = true, onExited, onMetadata }: ShellViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLPreElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const metadataRef = useRef<TerminalMetadata>({ title: null, cwd: null })
  const onExitedRef = useRef(onExited)
  const onMetadataRef = useRef(onMetadata)
  const visibleRef = useRef(visible)
  const focusFrameRef = useRef<number | null>(null)
  const ensureShellRunningRef = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onExitedRef.current = onExited
    onMetadataRef.current = onMetadata
  }, [onExited, onMetadata])

  useLayoutEffect(() => {
    visibleRef.current = visible
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }

    terminal.options.disableStdin = !visible
    if (!visible) {
      terminal.clearSelection()
      terminal.blur()
      return
    }

    // Re-attach stdin/focus and revive a PTY reaped after shell-lease expiry.
    ensureShellRunningRef.current?.()
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!visibleRef.current || terminalRef.current !== terminal) {
        return
      }

      terminal.options.disableStdin = false
      fitAddonRef.current?.fit()
      terminal.focus()
    })
  }, [visible])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const el = containerRef.current
    const terminal = new Terminal({
      theme: getAppTerminalTheme(),
      fontFamily: getTerminalFontFamily(useTerminalPreferencesStore.getState().fontFamily),
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: false,
      allowProposedApi: true,
      disableStdin: !visibleRef.current,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(el)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    if (visibleRef.current) {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current)
      }
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null
        if (!visibleRef.current || terminalRef.current !== terminal) {
          return
        }

        try {
          fitAddon.fit()
        }
        catch {
          // xterm may not be measurable during the first hidden layout pass.
        }
        terminal.focus()
      })
    }

    installTerminalAddons(terminal)

    // ── Unified resize debounce ───────────────────────────────────────────────
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let pendingCols = 0
    let pendingRows = 0
    let shellStarted = false
    let initDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let exitShown = false
    let pendingOscBuffer = ''
    let pendingTranscript = ''
    let transcriptFrame: number | null = null
    let fontFrame: number | null = null

    function setTranscript(next: string) {
      pendingTranscript = ''
      if (transcriptFrame !== null) {
        cancelAnimationFrame(transcriptFrame)
        transcriptFrame = null
      }
      const transcript = transcriptRef.current
      if (!transcript) {
        return
      }
      transcript.textContent = next.slice(-MAX_TRANSCRIPT_CHARS)
    }

    function appendTranscript(next: string) {
      const transcript = transcriptRef.current
      if (!transcript) {
        return
      }
      pendingTranscript += next
      if (transcriptFrame !== null) {
        return
      }

      transcriptFrame = requestAnimationFrame(() => {
        transcriptFrame = null
        const current = transcript.textContent ?? ''
        transcript.textContent = `${current}${pendingTranscript}`.slice(-MAX_TRANSCRIPT_CHARS)
        pendingTranscript = ''
      })
    }

    function publishMetadata(data: string) {
      if (!pendingOscBuffer && !data.includes('\u001B]')) {
        return
      }

      const input = `${pendingOscBuffer}${data}`
      pendingOscBuffer = getPendingOscSuffix(input)

      const nextMetadata = readTerminalMetadata(input)
      if (!nextMetadata.title && !nextMetadata.cwd) {
        return
      }

      const merged = mergeTerminalMetadata(metadataRef.current, nextMetadata)
      if (merged.title === metadataRef.current.title && merged.cwd === metadataRef.current.cwd) {
        return
      }

      metadataRef.current = merged
      onMetadataRef.current?.(merged)
    }

    function getPendingOscSuffix(data: string): string {
      const oscStart = data.lastIndexOf('\u001B]')
      if (oscStart === -1) {
        return ''
      }

      const suffix = data.slice(oscStart)
      if (suffix.includes('\u0007') || suffix.includes('\u001B\\')) {
        return ''
      }

      return suffix.slice(-MAX_OSC_LOOKBEHIND_CHARS)
    }

    function writeSnapshot(buffer: string, running: boolean) {
      terminal.reset()
      setTranscript(toPlainTerminalText(buffer))
      if (buffer) {
        publishMetadata(buffer)
        terminal.write(buffer)
      }
      if (!running && !exitShown) {
        exitShown = true
        appendTranscript(toPlainTerminalText(EXIT_BANNER))
        terminal.write(EXIT_BANNER)
      }
    }

    let processRunning = false
    let restarting = false
    let disposed = false
    // After a clean process exit we let the parent remove the tab. Background
    // lease expiry / socket death can leave a live tab attached to a dead PTY —
    // those recover via ensureShellRunning when the tab is visible again.
    let intentionalExit = false

    const lifetime = getTerminalLifetimeController()
    lifetime.register({
      terminalId: ptyId,
      adapterKind: 'bottom-panel',
      ownerId: ptyId.startsWith('terminal:')
        ? ptyId.slice('terminal:'.length).replace(/:\d+$/, '')
        : ptyId,
    })
    lifetime.attach(ptyId)

    const channel = createPtyChannel({
      socketPath: `/terminal-sessions/shell/${encodeURIComponent(ptyId)}/socket`,
      onSnapshot(event) {
        writeSnapshot(event.buffer, event.running)
        processRunning = event.running
        if (!event.running) {
          exitShown = true
        }
        if (
          !event.running
          && !intentionalExit
          && visibleRef.current
          && !disposed
        ) {
          void ensureShellRunning()
        }
      },
      onOutput(event) {
        if (event.data) {
          publishMetadata(event.data)
          appendTranscript(toPlainTerminalText(event.data))
          terminal.write(event.data)
        }
      },
      onExit() {
        processRunning = false
        intentionalExit = true
        if (!exitShown) {
          exitShown = true
          appendTranscript(toPlainTerminalText(EXIT_BANNER))
          terminal.write(EXIT_BANNER)
        }
        onExitedRef.current?.()
      },
      onError(event) {
        if (
          event.code === 'terminal_not_running'
          && !intentionalExit
          && visibleRef.current
          && !disposed
        ) {
          processRunning = false
          void ensureShellRunning()
        }
      },
    })

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
        if (processRunning) {
          channel.sendResize(lastCols, lastRows)
        }
      }, 100)
    }

    function resolveShellSize(): { cols: number, rows: number } | null {
      const dims = fitAddon.proposeDimensions()
      if (dims && dims.cols > 0 && dims.rows > 0) {
        return dims
      }
      if (lastCols > 0 && lastRows > 0) {
        return { cols: lastCols, rows: lastRows }
      }
      return null
    }

    async function ensureShellRunning(preferred?: { cols: number, rows: number }) {
      if (disposed || restarting || intentionalExit) {
        return
      }
      const size = preferred ?? resolveShellSize()
      if (!size) {
        return
      }

      restarting = true
      try {
        terminal.resize(size.cols, size.rows)
        lastCols = size.cols
        lastRows = size.rows

        await postTerminalSessionsShellStart({
          body: { ptyId, cwd, cols: size.cols, rows: size.rows },
        })
        if (disposed) {
          return
        }
        exitShown = false
        processRunning = true
        shellStarted = true
        channel.connect()
        setReady(true)
      }
      catch {
        if (disposed) {
          return
        }
        processRunning = false
        shellStarted = false
        setReady(false)
        terminal.write('\r\n\x1B[31m[Unable to start terminal]\x1B[0m\r\n')
      }
      finally {
        restarting = false
      }
    }

    function fitAndNotify() {
      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        return
      }

      if (!shellStarted) {
        if (initDebounceTimer) {
          clearTimeout(initDebounceTimer)
        }
        initDebounceTimer = setTimeout(() => {
          initDebounceTimer = null
          if (shellStarted || disposed) {
            return
          }
          const final = fitAddon.proposeDimensions()
          if (!final || final.cols <= 0 || final.rows <= 0) {
            return
          }
          void ensureShellRunning(final)
        }, 100)
        return
      }

      applyResize(dims.cols, dims.rows)
    }

    // ── Initial setup ────────────────────────────────────────────────────────
    void (async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (disposed) {
        return
      }

      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        // Wait for ResizeObserver / fitAndNotify once the panel has real size.
        return
      }

      if (initDebounceTimer) {
        clearTimeout(initDebounceTimer)
        initDebounceTimer = null
      }
      await ensureShellRunning(dims)
    })()

    // ── Live updates ─────────────────────────────────────────────────────────
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
        fitAndNotify()
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
        fitAndNotify()
      })
    })

    const dataDisposable = terminal.onData((data) => {
      if (!visibleRef.current || intentionalExit) {
        return
      }
      if (!processRunning) {
        void ensureShellRunning()
      }
      channel.sendInput(data)
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAndNotify()
    })
    resizeObserver.observe(el)

    const onPointerDown = () => {
      if (!visibleRef.current) {
        return
      }
      terminal.options.disableStdin = false
      terminal.focus()
      if (!processRunning && !intentionalExit) {
        void ensureShellRunning()
      }
    }
    el.addEventListener('pointerdown', onPointerDown)
    ensureShellRunningRef.current = () => {
      if (!processRunning && !intentionalExit) {
        void ensureShellRunning()
      }
    }

    return () => {
      disposed = true
      ensureShellRunningRef.current = null
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      if (initDebounceTimer) {
        clearTimeout(initDebounceTimer)
      }
      if (transcriptFrame !== null) {
        cancelAnimationFrame(transcriptFrame)
      }
      if (fontFrame !== null) {
        cancelAnimationFrame(fontFrame)
      }
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = null
      }
      getTerminalLifetimeController().park(ptyId)
      el.removeEventListener('pointerdown', onPointerDown)
      channel.close()
      dataDisposable.dispose()
      resizeObserver.disconnect()
      stopWatchingTheme()
      stopWatchingTerminalPreferences()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [ptyId, cwd])

  return (
    <div
      className="h-full w-full overflow-hidden bg-background"
      data-testid="shell-view"
      data-shell-view="true"
      data-shell-visible={visible ? 'true' : 'false'}
      data-shell-ready={ready ? 'true' : 'false'}
    >
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        style={{ padding: '4px 8px' }}
      />
      <pre className="sr-only" data-testid="shell-view-transcript" ref={transcriptRef} />
    </div>
  )
}
