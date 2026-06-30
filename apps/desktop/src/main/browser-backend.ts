import { existsSync, unlinkSync } from 'node:fs'
import type { Server, Socket } from 'node:net'
import { createServer } from 'node:net'
import { join } from 'node:path'

import {
  buildDocumentReadyExpression,
  buildElementCenterExpression,
  buildElementClickExpression,
  buildFocusedEditableStateExpression,
  buildKeyboardTextFallbackExpression,
  buildScrollActionExpression,
  buildTextReplacementExpression,
  createKeyEventPayload,
  isRecoverableNavigationAbort,
} from '@cradle/browser-use/browser-commands'
import type {
  AXNode,
  BrowserCommand,
  BrowserResponse,
  ClickResult,
  DomSnapshotResult,
  EvalResult,
  GetTextResult,
  HoverResult,
  KeyboardResult,
  NavigateResult,
  ScreenshotResult,
  ScrollResult,
  TabInfo,
  TabsCloseResult,
  TabsListResult,
  TabsNewResult,
  TypeResult,
  WaitForSelectorResult,
} from '@cradle/browser-use/protocol'
import { encodeFrame, FrameDecoder } from '@cradle/browser-use/protocol'
import { app, webContents } from 'electron'

let server: Server | null = null
let socketPath = ''

interface WebviewEntry { wc: Electron.WebContents, attached: boolean }

/** Tracked webview webContents by tab ID */
const webviewRegistry = new Map<string, WebviewEntry>()
let tabCounter = 0

function getSocketPath(): string {
  return join(app.getPath('userData'), 'browser-backend.sock')
}

async function waitForDocumentReady(entry: WebviewEntry): Promise<void> {
  ensureDebugger(entry)
  await entry.wc.debugger.sendCommand('Runtime.evaluate', {
    expression: buildDocumentReadyExpression(),
    awaitPromise: true,
    returnByValue: true,
  })
}

/** Ensure the debugger is attached to a webview entry, re-attaching if needed */
function ensureDebugger(entry: WebviewEntry): void {
  if (!entry.attached && !entry.wc.isDestroyed()) {
    try {
      entry.wc.debugger.attach('1.3')
      entry.attached = true
    }
    catch (err) {
      console.error('[browser-backend] Failed to re-attach debugger:', err)
    }
  }
}

/** Find the first available webview entry (fallback when no tabId specified) */
function getActiveWebview(): WebviewEntry | undefined {
  const entries = [...webviewRegistry.entries()]
  if (entries.length === 0) {
    // Fallback: scan all webContents for type 'webview'
    const wc = webContents.getAllWebContents().find(w => w.getType() === 'webview' && !w.isDestroyed())
    if (wc) {
      const id = registerWebview(wc)
      return webviewRegistry.get(id)
    }
    return undefined
  }
  return entries.at(-1)?.[1]
}

function getWebview(tabId?: string): WebviewEntry | undefined {
  if (tabId) {
    const entry = webviewRegistry.get(tabId)
    if (entry && !entry.wc.isDestroyed()) {
      return entry
    }
    webviewRegistry.delete(tabId)
    return undefined
  }
  return getActiveWebview()
}

async function handleCommand(cmd: BrowserCommand): Promise<BrowserResponse> {
  try {
    switch (cmd.type) {
      case 'navigate': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        try {
          await entry.wc.loadURL(cmd.url)
        }
        catch (err) {
          const finalUrl = entry.wc.getURL()
          if (!isRecoverableNavigationAbort(err, cmd.url, finalUrl)) {
            throw err
          }
        }
        await waitForDocumentReady(entry)
        const data: NavigateResult = { url: entry.wc.getURL(), title: entry.wc.getTitle() }
        return { id: cmd.id, ok: true, data }
      }

      case 'screenshot': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        const image = await entry.wc.capturePage()
        const data: ScreenshotResult = { base64: image.toPNG().toString('base64'), mimeType: 'image/png' }
        return { id: cmd.id, ok: true, data }
      }

      case 'click': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: click } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildElementClickExpression(cmd.selector),
          returnByValue: true,
        })
        if (!click?.found) { throw new Error(`Element not found: ${cmd.selector}`) }
        const data: ClickResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'type': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: replacement } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildTextReplacementExpression(cmd.selector, cmd.text),
          returnByValue: true,
        })
        if (!replacement?.found) { throw new Error(`Element not found: ${cmd.selector}`) }
        if (!replacement.editable) { throw new Error(`Element is not editable: ${cmd.selector}`) }
        const data: TypeResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'get_text': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: cmd.selector
            ? `document.querySelector(${JSON.stringify(cmd.selector)})?.innerText ?? ''`
            : `document.body.innerText`,
          returnByValue: true,
        })
        const data: GetTextResult = { text: value ?? '' }
        return { id: cmd.id, ok: true, data }
      }

      case 'scroll': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const amount = cmd.amount ?? 300
        const { result: { value: scroll } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildScrollActionExpression(cmd.selector, cmd.direction, amount),
          returnByValue: true,
        })
        if (!scroll?.found) { throw new Error(`Element not found: ${cmd.selector}`) }
        if (scroll.canMove && !scroll.moved) { throw new Error(`Scroll did not move: ${cmd.direction}`) }
        const data: ScrollResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'hover': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: box } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildElementCenterExpression(cmd.selector),
          returnByValue: true,
        })
        if (!box) { throw new Error(`Element not found: ${cmd.selector}`) }
        await entry.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
x: box.x,
y: box.y,
        })
        const data: HoverResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'dom_snapshot': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { nodes } = await entry.wc.debugger.sendCommand('Accessibility.getFullAXTree', {})
        const transformed: AXNode[] = nodes
          .filter((n: any) => n.ignored !== true)
          .map((n: any) => ({
            role: n.role?.value ?? 'unknown',
            name: n.name?.value ?? '',
            value: n.value?.value,
            description: n.description?.value,
          }))
        const data: DomSnapshotResult = { nodes: transformed }
        return { id: cmd.id, ok: true, data }
      }

      case 'wait_for_selector': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const timeout = cmd.timeout ?? 5000
        const start = Date.now()
        while (Date.now() - start < timeout) {
          const { result: { value } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
            expression: `!!document.querySelector(${JSON.stringify(cmd.selector)})`,
            returnByValue: true,
          })
          if (value) { break }
          await new Promise(r => setTimeout(r, 100))
        }
        const { result: { value: found } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(cmd.selector)})`,
          returnByValue: true,
        })
        if (!found) { throw new Error(`Timeout waiting for selector: ${cmd.selector}`) }
        const data: WaitForSelectorResult = { found: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'keyboard': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: before } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildFocusedEditableStateExpression(),
          returnByValue: true,
        })
        await entry.wc.debugger.sendCommand('Input.dispatchKeyEvent', createKeyEventPayload('keyDown', cmd.key, cmd.modifiers))
        await entry.wc.debugger.sendCommand('Input.dispatchKeyEvent', createKeyEventPayload('keyUp', cmd.key, cmd.modifiers))
        const { result: { value: after } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: buildFocusedEditableStateExpression(),
          returnByValue: true,
        })
        if (before?.editable && after?.editable && before.value === after.value) {
          await entry.wc.debugger.sendCommand('Runtime.evaluate', {
            expression: buildKeyboardTextFallbackExpression(cmd.key, cmd.modifiers),
            returnByValue: true,
          })
        }
        const data: KeyboardResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_list': {
        const tabs: TabInfo[] = []
        for (const [id, entry] of webviewRegistry) {
          if (entry.wc.isDestroyed()) {
            webviewRegistry.delete(id)
            continue
          }
          tabs.push({ id, url: entry.wc.getURL(), title: entry.wc.getTitle() })
        }
        const data: TabsListResult = { tabs }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_new': {
        const entry = getActiveWebview()
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available. Browser panel must be open.' }
        }
        if (cmd.url) {
          try {
            await entry.wc.loadURL(cmd.url)
          }
          catch (err) {
            const finalUrl = entry.wc.getURL()
            if (!isRecoverableNavigationAbort(err, cmd.url, finalUrl)) {
              throw err
            }
          }
          await waitForDocumentReady(entry)
        }
        const id = [...webviewRegistry.entries()].find(([, e]) => e.wc === entry.wc)?.[0] ?? 'unknown'
        const data: TabsNewResult = { tab: { id, url: entry.wc.getURL(), title: entry.wc.getTitle() } }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_close': {
        const entry = webviewRegistry.get(cmd.tabId)
        if (!entry || entry.wc.isDestroyed()) {
          webviewRegistry.delete(cmd.tabId)
          return { id: cmd.id, ok: false, error: `Tab ${cmd.tabId} not found` }
        }
        try { entry.wc.debugger.detach() }
        catch { /* already detached */ }
        entry.wc.close()
        webviewRegistry.delete(cmd.tabId)
        const data: TabsCloseResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'eval': {
        const entry = getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value } } = await entry.wc.debugger.sendCommand('Runtime.evaluate', {
          expression: cmd.expression,
          returnByValue: true,
        })
        const data: EvalResult = { result: value }
        return { id: cmd.id, ok: true, data }
      }

      default:
        return { id: (cmd as BrowserCommand).id, ok: false, error: `Unknown command type` }
    }
  }
  catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function handleConnection(socket: Socket): void {
  const decoder = new FrameDecoder()

  socket.on('data', (chunk) => {
    const messages = decoder.push(chunk)
    for (const msg of messages) {
      handleCommand(msg as BrowserCommand).then((response) => {
        socket.write(encodeFrame(response))
      })
    }
  })

  socket.on('error', () => {
    // Client disconnected — no-op
  })
}

/** Register a webview webContents (called when renderer attaches a webview) */
export function registerWebview(wc: Electron.WebContents): string {
  const id = `tab-${++tabCounter}`

  // Attach CDP debugger
  let attached = false
  try {
    wc.debugger.attach('1.3')
    attached = true
  }
  catch (err) {
    console.error('[browser-backend] Failed to attach debugger:', err)
  }

  const entry: WebviewEntry = { wc, attached }
  webviewRegistry.set(id, entry)

  // Handle debugger detach
  wc.debugger.on('detach', (_event, reason) => {
    console.warn(`[browser-backend] Debugger detached from ${id}: ${reason}`)
    entry.attached = false
  })

  wc.once('destroyed', () => {
    webviewRegistry.delete(id)
  })

  return id
}

/** Start the browser backend socket server */
export function startBrowserBackend(): void {
  socketPath = getSocketPath()

  // Clean up stale socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  server = createServer(handleConnection)
  server.listen(socketPath)
  server.on('error', (err) => {
    console.error('[browser-backend] Socket server error:', err)
  })
}

/** Stop the browser backend */
export function stopBrowserBackend(): void {
  // Detach all debuggers
  for (const [, entry] of webviewRegistry) {
    if (entry.attached && !entry.wc.isDestroyed()) {
      try { entry.wc.debugger.detach() }
      catch { /* ignore */ }
    }
  }
  webviewRegistry.clear()

  if (server) {
    server.close()
    server = null
  }
  if (socketPath && existsSync(socketPath)) {
    unlinkSync(socketPath)
  }
}

/** Get the socket path for clients to connect to */
export function getBrowserBackendSocketPath(): string {
  return socketPath
}
