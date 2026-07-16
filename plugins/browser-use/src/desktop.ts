import { existsSync, unlinkSync } from 'node:fs'
import type { AddressInfo, Server, Socket } from 'node:net'
import { createServer } from 'node:net'
import { join } from 'node:path'

import type { Disposable } from '@cradle/plugin-sdk'
import type { DesktopPluginContext, DesktopWebview } from '@cradle/plugin-sdk/desktop'

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
} from './browser-commands.js'
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
  TabsVisibilityResult,
  TypeResult,
  WaitForSelectorResult,
} from './protocol.js'
import { encodeFrame, FrameDecoder } from './protocol.js'

let server: Server | null = null
let socketPath = ''
let backendEndpoint = ''

interface WebviewEntry {
  webview: DesktopWebview
  attached: boolean
  subscriptions: Disposable[]
}

interface CdpValueResult<T> {
  result: {
    value: T
  }
}

interface CdpAxNode {
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  description?: { value?: string }
}

interface CdpAxTreeResult {
  nodes: CdpAxNode[]
}

const webviewRegistry = new Map<string, WebviewEntry>()
const pendingWebviewResolvers = new Map<string, Array<(tabId: string) => void>>()

let desktopContext: DesktopPluginContext | null = null

function disposeWebviewEntry(entry: WebviewEntry): void {
  for (const subscription of entry.subscriptions.splice(0).reverse()) {
    subscription.dispose()
  }
}

function removeWebviewEntry(id: string, entry: WebviewEntry): void {
  if (webviewRegistry.get(id) !== entry) {
    return
  }
  webviewRegistry.delete(id)
  disposeWebviewEntry(entry)
}

async function waitForDocumentReady(entry: WebviewEntry): Promise<void> {
  ensureDebugger(entry)
  await entry.webview.cdp.sendCommand('Runtime.evaluate', {
    expression: buildDocumentReadyExpression(),
    awaitPromise: true,
    returnByValue: true,
  })
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

async function activateRendererTab(entry: WebviewEntry): Promise<void> {
  if (!desktopContext) {
    return
  }
  const activated = await desktopContext.browserTabs.activate(entry.webview.tabId)
  if (activated) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

function ensureDebugger(entry: WebviewEntry): void {
  if (!entry.attached && !entry.webview.isDestroyed()) {
    try {
      entry.webview.cdp.attach('1.3')
      entry.attached = true
    }
    catch (err) {
      console.error('[browser-use] Failed to re-attach debugger:', err)
    }
  }
}

async function getActiveWebview(): Promise<WebviewEntry | undefined> {
  if (desktopContext) {
    const rendererTabId = await desktopContext.browserTabs.getActive()
    if (rendererTabId) {
      const activeEntry = webviewRegistry.get(rendererTabId)
      if (activeEntry) {
        if (activeEntry.webview.isDestroyed()) {
          removeWebviewEntry(rendererTabId, activeEntry)
        }
        else {
          return activeEntry
        }
      }
    }
  }

  const entries = [...webviewRegistry.entries()]
  if (entries.length === 0) {
    return undefined
  }
  return entries.at(-1)![1]
}

async function getWebview(tabId?: string): Promise<WebviewEntry | undefined> {
  if (tabId) {
    const entry = webviewRegistry.get(tabId)
    if (entry && !entry.webview.isDestroyed()) {
      return entry
    }
    if (entry) {
      removeWebviewEntry(tabId, entry)
    }
    return undefined
  }
  return getActiveWebview()
}

function registerWebview(webview: DesktopWebview): string {
  const id = webview.tabId
  const previousEntry = webviewRegistry.get(id)
  if (previousEntry) {
    disposeWebviewEntry(previousEntry)
  }

  let attached = false
  try {
    webview.cdp.attach('1.3')
    attached = true
  }
  catch (err) {
    console.error('[browser-use] Failed to attach debugger:', err)
  }

  const entry: WebviewEntry = { webview, attached, subscriptions: [] }
  webviewRegistry.set(id, entry)

  entry.subscriptions.push(webview.cdp.onDetached((reason) => {
    console.warn(`[browser-use] Debugger detached from ${id}: ${reason}`)
    entry.attached = false
  }))

  entry.subscriptions.push(webview.onDestroyed(() => {
    removeWebviewEntry(id, entry)
  }))

  const resolvers = pendingWebviewResolvers.get(id)
  if (resolvers) {
    pendingWebviewResolvers.delete(id)
    for (const resolve of resolvers) {
      resolve(id)
    }
  }

  return id
}

function waitForRegisteredWebview(rendererTabId: string): Promise<string> {
  if (webviewRegistry.has(rendererTabId)) {
    return Promise.resolve(rendererTabId)
  }

  return new Promise<string>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const wrappedResolve = (tabId: string) => {
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve(tabId)
    }
    timeout = setTimeout(() => {
      const resolvers = pendingWebviewResolvers.get(rendererTabId)
      if (resolvers) {
        const nextResolvers = resolvers.filter(candidate => candidate !== wrappedResolve)
        if (nextResolvers.length > 0) {
          pendingWebviewResolvers.set(rendererTabId, nextResolvers)
        }
        else {
          pendingWebviewResolvers.delete(rendererTabId)
        }
      }
      reject(new Error(`Timed out waiting for renderer browser tab ${rendererTabId}`))
    }, 5000)

    const resolvers = pendingWebviewResolvers.get(rendererTabId) ?? []
    pendingWebviewResolvers.set(rendererTabId, [...resolvers, wrappedResolve])
  })
}

async function requestRendererBrowserTab(url?: string): Promise<string> {
  if (!desktopContext) {
    throw new Error('Desktop plugin context is not available')
  }

  const rendererTabId = await desktopContext.browserTabs.request(url)
  if (!rendererTabId) {
    throw new Error('Renderer did not create a browser tab')
  }

  return waitForRegisteredWebview(rendererTabId)
}

async function handleCommand(cmd: BrowserCommand): Promise<BrowserResponse> {
  try {
    switch (cmd.type) {
      case 'navigate': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        try {
          await entry.webview.navigate(cmd.url)
        }
        catch (err) {
          const finalUrl = entry.webview.getUrl()
          if (!isRecoverableNavigationAbort(err, cmd.url, finalUrl)) {
            throw err
          }
        }
        await waitForDocumentReady(entry)
        const data: NavigateResult = { url: entry.webview.getUrl(), title: entry.webview.getTitle() }
        return { id: cmd.id, ok: true, data }
      }

      case 'screenshot': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        const png = await withTimeout(entry.webview.capturePng(), 3000, 'Screenshot capture')
        const data: ScreenshotResult = { base64: Buffer.from(png).toString('base64'), mimeType: 'image/png' }
        return { id: cmd.id, ok: true, data }
      }

      case 'click': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: click } } = await entry.webview.cdp.sendCommand<CdpValueResult<{ found?: boolean }>>('Runtime.evaluate', {
          expression: buildElementClickExpression(cmd.selector),
          returnByValue: true,
        })
        if (!click?.found) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        const data: ClickResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'type': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: replacement } } = await entry.webview.cdp.sendCommand<CdpValueResult<{ found?: boolean, editable?: boolean }>>('Runtime.evaluate', {
          expression: buildTextReplacementExpression(cmd.selector, cmd.text),
          returnByValue: true,
        })
        if (!replacement?.found) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        if (!replacement.editable) {
          throw new Error(`Element is not editable: ${cmd.selector}`)
        }
        const data: TypeResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'get_text': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value } } = await entry.webview.cdp.sendCommand<CdpValueResult<string | undefined>>('Runtime.evaluate', {
          expression: cmd.selector
            ? `document.querySelector(${JSON.stringify(cmd.selector)})?.innerText ?? ''`
            : `document.body.innerText`,
          returnByValue: true,
        })
        const data: GetTextResult = { text: value ?? '' }
        return { id: cmd.id, ok: true, data }
      }

      case 'scroll': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const amount = cmd.amount ?? 300
        const { result: { value: scroll } } = await entry.webview.cdp.sendCommand<CdpValueResult<{ found?: boolean, canMove?: boolean, moved?: boolean }>>('Runtime.evaluate', {
          expression: buildScrollActionExpression(cmd.selector, cmd.direction, amount),
          returnByValue: true,
        })
        if (!scroll?.found) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        if (scroll.canMove && !scroll.moved) {
          throw new Error(`Scroll did not move: ${cmd.direction}`)
        }
        const data: ScrollResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'hover': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: box } } = await entry.webview.cdp.sendCommand<CdpValueResult<{ x: number, y: number } | undefined>>('Runtime.evaluate', {
          expression: buildElementCenterExpression(cmd.selector),
          returnByValue: true,
        })
        if (!box) {
          throw new Error(`Element not found: ${cmd.selector}`)
        }
        await entry.webview.cdp.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: box.x,
          y: box.y,
        })
        const data: HoverResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'dom_snapshot': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { nodes } = await entry.webview.cdp.sendCommand<CdpAxTreeResult>('Accessibility.getFullAXTree', {})
        const transformed: AXNode[] = nodes
          .filter(n => n.ignored !== true)
          .map(n => ({
            role: n.role?.value ?? 'unknown',
            name: n.name?.value ?? '',
            value: n.value?.value,
            description: n.description?.value,
          }))
        const data: DomSnapshotResult = { nodes: transformed }
        return { id: cmd.id, ok: true, data }
      }

      case 'wait_for_selector': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const timeout = cmd.timeout ?? 5000
        const start = Date.now()
        while (Date.now() - start < timeout) {
          const { result: { value } } = await entry.webview.cdp.sendCommand<CdpValueResult<boolean>>('Runtime.evaluate', {
            expression: `!!document.querySelector(${JSON.stringify(cmd.selector)})`,
            returnByValue: true,
          })
          if (value) {
            break
          }
          await new Promise(r => setTimeout(r, 100))
        }
        const { result: { value: found } } = await entry.webview.cdp.sendCommand<CdpValueResult<boolean>>('Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(cmd.selector)})`,
          returnByValue: true,
        })
        if (!found) {
          throw new Error(`Timeout waiting for selector: ${cmd.selector}`)
        }
        const data: WaitForSelectorResult = { found: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'keyboard': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value: before } } = await entry.webview.cdp.sendCommand<CdpValueResult<{ editable?: boolean, value?: string }>>('Runtime.evaluate', {
          expression: buildFocusedEditableStateExpression(),
          returnByValue: true,
        })
        await entry.webview.cdp.sendCommand('Input.dispatchKeyEvent', createKeyEventPayload('keyDown', cmd.key, cmd.modifiers))
        await entry.webview.cdp.sendCommand('Input.dispatchKeyEvent', createKeyEventPayload('keyUp', cmd.key, cmd.modifiers))
        const { result: { value: after } } = await entry.webview.cdp.sendCommand<CdpValueResult<{ editable?: boolean, value?: string }>>('Runtime.evaluate', {
          expression: buildFocusedEditableStateExpression(),
          returnByValue: true,
        })
        if (before?.editable && after?.editable && before.value === after.value) {
          await entry.webview.cdp.sendCommand('Runtime.evaluate', {
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
          if (entry.webview.isDestroyed()) {
            removeWebviewEntry(id, entry)
            continue
          }
          tabs.push({ id, url: entry.webview.getUrl(), title: entry.webview.getTitle() })
        }
        const data: TabsListResult = { tabs }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_new': {
        const newTabId = await requestRendererBrowserTab(cmd.url)
        const entry = await getWebview(newTabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'New browser tab was not registered' }
        }
        if (cmd.url && entry.webview.getUrl() !== cmd.url) {
          await entry.webview.navigate(cmd.url)
        }
        if (cmd.url) {
          await waitForDocumentReady(entry)
        }
        const data: TabsNewResult = { tab: { id: newTabId, url: entry.webview.getUrl(), title: entry.webview.getTitle() } }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_close': {
        const entry = webviewRegistry.get(cmd.tabId)
        if (!entry || entry.webview.isDestroyed()) {
          if (entry) {
            removeWebviewEntry(cmd.tabId, entry)
          }
          return { id: cmd.id, ok: false, error: `Tab ${cmd.tabId} not found` }
        }
        removeWebviewEntry(cmd.tabId, entry)
        try {
          entry.webview.cdp.detach()
        }
        catch { /* already detached */ }
        entry.webview.close()
        const data: TabsCloseResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_go_off_screen': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        if (!desktopContext) {
          return { id: cmd.id, ok: false, error: 'Desktop plugin context is not available' }
        }
        const hidden = await desktopContext.browserTabs.goOffScreen(entry.webview.tabId)
        if (!hidden) {
          return { id: cmd.id, ok: false, error: 'Browser tab could not be moved off screen' }
        }
        const data: TabsVisibilityResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'tabs_bring_to_front': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        await activateRendererTab(entry)
        const data: TabsVisibilityResult = { success: true }
        return { id: cmd.id, ok: true, data }
      }

      case 'eval': {
        const entry = await getWebview(cmd.tabId)
        if (!entry) {
          return { id: cmd.id, ok: false, error: 'No webview available' }
        }
        ensureDebugger(entry)
        const { result: { value } } = await entry.webview.cdp.sendCommand<CdpValueResult<unknown>>('Runtime.evaluate', {
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
  socket.on('data', (chunk: Buffer) => {
    const messages = decoder.push(chunk)
    for (const msg of messages) {
      handleCommand(msg as BrowserCommand).then((response) => {
        socket.write(encodeFrame(response))
      })
    }
  })
  socket.on('error', () => {})
}

async function listenBrowserBackend(nextServer: Server, ctx: DesktopPluginContext): Promise<string> {
  if (process.platform === 'win32') {
    return new Promise((resolveEndpoint, reject) => {
      const onError = (err: Error) => {
        nextServer.off('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        nextServer.off('error', onError)
        const address = nextServer.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Browser backend TCP listener did not expose a port.'))
          return
        }
        resolveEndpoint(`tcp://127.0.0.1:${(address as AddressInfo).port}`)
      }
      nextServer.once('error', onError)
      nextServer.once('listening', onListening)
      nextServer.listen(0, '127.0.0.1')
    })
  }

  socketPath = join(ctx.userDataPath, 'browser-backend.sock')
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  return new Promise((resolveEndpoint, reject) => {
    const onError = (err: Error) => {
      nextServer.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      nextServer.off('error', onError)
      resolveEndpoint(socketPath)
    }
    nextServer.once('error', onError)
    nextServer.once('listening', onListening)
    nextServer.listen(socketPath)
  })
}

export async function activate(ctx: DesktopPluginContext): Promise<void> {
  desktopContext = ctx
  const nextServer = createServer(handleConnection)
  server = nextServer

  try {
    backendEndpoint = await listenBrowserBackend(nextServer, ctx)
  }
  catch (err) {
    server = null
    if (nextServer.listening) {
      nextServer.close()
    }
    throw err
  }

  nextServer.on('error', (err) => {
    ctx.logger.error('Browser backend server error:', err)
  })

  // Propagate socket path to server via shared config
  ctx.sharedConfig.set('BROWSER_BACKEND_SOCKET', backendEndpoint)

  // Listen for webview creation
  ctx.webviews.onCreated((webview, _tabId) => {
    registerWebview(webview)
  })

  ctx.logger.info(`Browser backend started on ${backendEndpoint}`)
}

export function deactivate(): void {
  desktopContext = null
  pendingWebviewResolvers.clear()
  // Detach all debuggers
  for (const [, entry] of webviewRegistry) {
    disposeWebviewEntry(entry)
    if (entry.attached && !entry.webview.isDestroyed()) {
      try {
        entry.webview.cdp.detach()
      }
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
  socketPath = ''
  backendEndpoint = ''
}
