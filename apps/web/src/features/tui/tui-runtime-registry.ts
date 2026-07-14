import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import { startOrAttachTerminalSession } from './api/terminal-session'
import { getAppTerminalTheme, watchTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'
import { createPtyChannel } from './pty-channel'
import { installTerminalAddons } from './terminal-addons'
import { getTerminalFontFamily } from './terminal-font'
import { useTerminalPreferencesStore } from './terminal-preferences'

const EXIT_BANNER = '\r\n\x1B[2m[Process exited]\x1B[0m\r\n'
const TUI_PARKING_CONTAINER_ID = 'cradle-tui-runtime-parking'

interface TuiRuntimeEntry {
  sessionId: string
  wrapper: HTMLDivElement
  container: HTMLDivElement | null
  terminal: Terminal
  fitAddon: FitAddon
  channel: ReturnType<typeof createPtyChannel>
  ready: boolean
  visible: boolean
  disposed: boolean
  exitShown: boolean
  lastCols: number
  lastRows: number
  pendingCols: number
  pendingRows: number
  resizeTimer: ReturnType<typeof setTimeout> | null
  fontFrame: number | null
  focusFrame: number | null
  resizeObserver: ResizeObserver
  dataDisposable: { dispose: () => void }
  stopWatchingTheme: () => void
  stopWatchingPreferences: () => void
  readyListeners: Set<(ready: boolean) => void>
}

function getParkingContainer(): HTMLDivElement {
  const existing = document.getElementById(TUI_PARKING_CONTAINER_ID)
  if (existing instanceof HTMLDivElement) {
    return existing
  }
  const parking = document.createElement('div')
  parking.id = TUI_PARKING_CONTAINER_ID
  parking.hidden = true
  parking.setAttribute('aria-hidden', 'true')
  document.body.append(parking)
  return parking
}

function notifyReady(entry: TuiRuntimeEntry, ready: boolean): void {
  if (entry.ready === ready) {
    return
  }
  entry.ready = ready
  for (const listener of entry.readyListeners) {
    listener(ready)
  }
}

function proposeDimensions(entry: TuiRuntimeEntry): { cols: number, rows: number } | null {
  const dimensions = entry.fitAddon.proposeDimensions()
  return dimensions && dimensions.cols > 0 && dimensions.rows > 0 ? dimensions : null
}

function applyResize(entry: TuiRuntimeEntry, cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0) {
    return
  }
  entry.pendingCols = cols
  entry.pendingRows = rows
  if (entry.resizeTimer) {
    clearTimeout(entry.resizeTimer)
  }
  entry.resizeTimer = setTimeout(() => {
    entry.resizeTimer = null
    if (entry.disposed || (entry.pendingCols === entry.lastCols && entry.pendingRows === entry.lastRows)) {
      return
    }
    entry.terminal.resize(entry.pendingCols, entry.pendingRows)
    entry.lastCols = entry.pendingCols
    entry.lastRows = entry.pendingRows
    entry.channel.sendResize(entry.lastCols, entry.lastRows)
  }, 100)
}

function refit(entry: TuiRuntimeEntry): void {
  if (!entry.visible || !entry.container) {
    return
  }
  const dimensions = proposeDimensions(entry)
  if (dimensions) {
    applyResize(entry, dimensions.cols, dimensions.rows)
  }
}

function setVisible(entry: TuiRuntimeEntry, visible: boolean): void {
  entry.visible = visible
  entry.terminal.options.disableStdin = !visible
  if (entry.focusFrame !== null) {
    cancelAnimationFrame(entry.focusFrame)
    entry.focusFrame = null
  }
  if (!visible) {
    entry.terminal.clearSelection()
    entry.terminal.blur()
    return
  }

  entry.focusFrame = requestAnimationFrame(() => {
    entry.focusFrame = null
    if (entry.disposed || !entry.visible) {
      return
    }
    refit(entry)
    entry.terminal.focus()
  })
}

function createRuntimeEntry(sessionId: string, container: HTMLDivElement): TuiRuntimeEntry {
  const wrapper = document.createElement('div')
  wrapper.className = 'h-full w-full overflow-hidden'
  container.replaceChildren(wrapper)

  const terminal = new Terminal({
    theme: getAppTerminalTheme(),
    fontFamily: getTerminalFontFamily(useTerminalPreferencesStore.getState().fontFamily),
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    allowTransparency: false,
    allowProposedApi: true,
    disableStdin: true,
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(wrapper)
  installTerminalAddons(terminal)
  attachMacKeyboardHandler(terminal)

  let entry!: TuiRuntimeEntry
  const channel = createPtyChannel({
    socketPath: `/terminal-sessions/${encodeURIComponent(sessionId)}/socket`,
    onSnapshot(event) {
      terminal.reset()
      if (event.buffer) {
        terminal.write(event.buffer)
      }
      if (!event.running && !entry.exitShown) {
        entry.exitShown = true
        terminal.write(EXIT_BANNER)
      }
    },
    onOutput(event) {
      if (event.data) {
        terminal.write(event.data)
      }
    },
    onExit() {
      if (!entry.exitShown) {
        entry.exitShown = true
        terminal.write(EXIT_BANNER)
      }
    },
  })

  const resizeObserver = new ResizeObserver(() => refit(entry))
  const stopWatchingTheme = watchTerminalTheme(() => {
    terminal.options.theme = getAppTerminalTheme()
    const fontFamily = getTerminalFontFamily(useTerminalPreferencesStore.getState().fontFamily)
    if (fontFamily !== terminal.options.fontFamily) {
      terminal.options.fontFamily = fontFamily
      if (entry.fontFrame !== null) {
        cancelAnimationFrame(entry.fontFrame)
      }
      entry.fontFrame = requestAnimationFrame(() => {
        entry.fontFrame = null
        refit(entry)
      })
    }
  })
  const stopWatchingPreferences = useTerminalPreferencesStore.subscribe((state, previousState) => {
    const fontFamily = getTerminalFontFamily(state.fontFamily)
    if (fontFamily === getTerminalFontFamily(previousState.fontFamily)) {
      return
    }
    terminal.options.fontFamily = fontFamily
    if (entry.fontFrame !== null) {
      cancelAnimationFrame(entry.fontFrame)
    }
    entry.fontFrame = requestAnimationFrame(() => {
      entry.fontFrame = null
      refit(entry)
    })
  })
  const dataDisposable = terminal.onData((data) => {
    if (entry.visible) {
      channel.sendInput(data)
    }
  })

  entry = {
    sessionId,
    wrapper,
    container,
    terminal,
    fitAddon,
    channel,
    ready: false,
    visible: false,
    disposed: false,
    exitShown: false,
    lastCols: 0,
    lastRows: 0,
    pendingCols: 0,
    pendingRows: 0,
    resizeTimer: null,
    fontFrame: null,
    focusFrame: null,
    resizeObserver,
    dataDisposable,
    stopWatchingTheme,
    stopWatchingPreferences,
    readyListeners: new Set(),
  }
  resizeObserver.observe(container)

  requestAnimationFrame(() => {
    if (entry.disposed) {
      return
    }
    const dimensions = proposeDimensions(entry) ?? { cols: 80, rows: 24 }
    terminal.resize(dimensions.cols, dimensions.rows)
    entry.lastCols = dimensions.cols
    entry.lastRows = dimensions.rows

    void startOrAttachTerminalSession(sessionId, dimensions).then(() => {
      if (entry.disposed) {
        return
      }
      channel.connect()
      notifyReady(entry, true)
    }).catch(() => {
      if (!entry.disposed) {
        terminal.write('\r\n\x1B[31m[Unable to start CLI TUI]\x1B[0m\r\n')
      }
    })
  })

  return entry
}

class TuiRuntimeRegistry {
  private entries = new Map<string, TuiRuntimeEntry>()

  attach(
    sessionId: string,
    container: HTMLDivElement,
    visible: boolean,
    onReadyChange: (ready: boolean) => void,
  ): void {
    let entry = this.entries.get(sessionId)
    if (!entry) {
      entry = createRuntimeEntry(sessionId, container)
      this.entries.set(sessionId, entry)
    }
    else if (entry.container !== container) {
      entry.resizeObserver.disconnect()
      entry.container = container
      container.replaceChildren(entry.wrapper)
      entry.resizeObserver.observe(container)
    }

    entry.readyListeners.add(onReadyChange)
    onReadyChange(entry.ready)
    setVisible(entry, visible)
  }

  setVisible(sessionId: string, visible: boolean): void {
    const entry = this.entries.get(sessionId)
    if (entry) {
      setVisible(entry, visible)
    }
  }

  detach(
    sessionId: string,
    container: HTMLDivElement,
    onReadyChange: (ready: boolean) => void,
  ): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    entry.readyListeners.delete(onReadyChange)
    if (entry.container !== container) {
      return
    }
    setVisible(entry, false)
    entry.resizeObserver.disconnect()
    getParkingContainer().append(entry.wrapper)
    entry.container = null
  }

  sendInput(sessionId: string, data: string): void {
    this.entries.get(sessionId)?.channel.sendInput(data)
  }

  dispose(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    entry.disposed = true
    if (entry.resizeTimer) {
      clearTimeout(entry.resizeTimer)
    }
    if (entry.fontFrame !== null) {
      cancelAnimationFrame(entry.fontFrame)
    }
    if (entry.focusFrame !== null) {
      cancelAnimationFrame(entry.focusFrame)
    }
    entry.resizeObserver.disconnect()
    entry.dataDisposable.dispose()
    entry.stopWatchingTheme()
    entry.stopWatchingPreferences()
    entry.channel.close()
    entry.terminal.dispose()
    entry.wrapper.remove()
    entry.readyListeners.clear()
    this.entries.delete(sessionId)
  }
}

export const tuiRuntimeRegistry = new TuiRuntimeRegistry()
