import { mkdtempSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Disposable } from '@cradle/plugin-sdk'
import type { DesktopPluginContext, DesktopWebview } from '@cradle/plugin-sdk/desktop'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { activate, deactivate } from './desktop'
import type { BrowserCommand, BrowserResponse } from './protocol'
import { encodeFrame, FrameDecoder } from './protocol'

function sendCommand(socketPath: string, command: BrowserCommand): Promise<BrowserResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    const decoder = new FrameDecoder()
    socket.on('connect', () => socket.write(encodeFrame(command)))
    socket.on('data', (chunk) => {
      const [response] = decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (response) {
        socket.destroy()
        resolve(response as BrowserResponse)
      }
    })
    socket.on('error', reject)
  })
}

describe('browser-use desktop webview lifecycle', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    deactivate()
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
    vi.restoreAllMocks()
  })

  it('replaces webview subscriptions when the same browser tab is registered again', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cradle-browser-use-'))
    tempDirectories.push(userDataPath)

    let onCreated: ((webview: DesktopWebview, tabId: string, ownerId: string) => void) | undefined
    const context: DesktopPluginContext = {
      userDataPath,
      subscriptions: [],
      webviews: {
        onCreated(handler) {
          onCreated = handler
          return { dispose: () => {} }
        },
      },
      browserTabs: {
        request: async () => undefined,
        activate: async () => false,
        goOffScreen: async () => false,
        getActive: async () => undefined,
      },
      sharedConfig: { set: vi.fn() },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      manifest: {
        name: '@cradle/browser-use',
        version: '0.0.1',
        packageDir: userDataPath,
        cradle: {
          apiVersion: '1',
          contributes: { capabilities: [], permissions: [] },
        },
      },
    }
    await activate(context)

    const detachedHandlers = new Set<(reason: string) => void>()
    const destroyedHandlers = new Set<() => void>()
    const subscribe = <T extends (...args: never[]) => void>(handlers: Set<T>, handler: T): Disposable => {
      handlers.add(handler)
      return { dispose: () => handlers.delete(handler) }
    }
    const webview: DesktopWebview = {
      ownerId: 'chat:session-a',
      tabId: 'tab-1',
      isDestroyed: () => false,
      navigate: async () => {},
      getUrl: () => 'https://example.test/',
      getTitle: () => 'Example',
      capturePng: async () => new Uint8Array(),
      close: vi.fn(),
      onDestroyed: handler => subscribe(destroyedHandlers, handler),
      cdp: {
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: async <T>() => undefined as T,
        onDetached: handler => subscribe(detachedHandlers, handler),
      },
    }

    onCreated?.(webview, webview.tabId, webview.ownerId)
    onCreated?.(webview, webview.tabId, webview.ownerId)

    expect(detachedHandlers).toHaveLength(1)
    expect(destroyedHandlers).toHaveLength(1)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const handler of detachedHandlers) {
      handler('target closed')
    }
    expect(warn).toHaveBeenCalledTimes(1)

    deactivate()
    expect(detachedHandlers).toHaveLength(0)
    expect(destroyedHandlers).toHaveLength(0)
  })

  it('isolates default lookup, listing, and tab IDs by browser owner', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cradle-browser-use-'))
    tempDirectories.push(userDataPath)

    let onCreated: ((webview: DesktopWebview, tabId: string, ownerId: string) => void) | undefined
    const getActive = vi.fn(async (ownerId: string) => ownerId === 'chat:session-a' ? 'tab-a' : 'tab-b')
    const context: DesktopPluginContext = {
      userDataPath,
      subscriptions: [],
      webviews: {
        onCreated(handler) {
          onCreated = handler
          return { dispose: () => {} }
        },
      },
      browserTabs: {
        request: async () => undefined,
        activate: async () => false,
        goOffScreen: async () => false,
        getActive,
      },
      sharedConfig: { set: vi.fn() },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      manifest: {
        name: '@cradle/browser-use',
        version: '0.0.1',
        packageDir: userDataPath,
        cradle: {
          apiVersion: '1',
          contributes: { capabilities: [], permissions: [] },
        },
      },
    }
    await activate(context)

    const createWebview = (ownerId: string, tabId: string, url: string): DesktopWebview => ({
      ownerId,
      tabId,
      isDestroyed: () => false,
      navigate: vi.fn(async () => {}),
      getUrl: () => url,
      getTitle: () => ownerId,
      capturePng: async () => new Uint8Array(),
      close: vi.fn(),
      onDestroyed: () => ({ dispose: () => {} }),
      cdp: {
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: async <T>() => undefined as T,
        onDetached: () => ({ dispose: () => {} }),
      },
    })
    const sessionAWebview = createWebview('chat:session-a', 'tab-a', 'https://a.example.test/')
    const sessionBWebview = createWebview('chat:session-b', 'tab-b', 'https://b.example.test/')
    onCreated?.(sessionAWebview, sessionAWebview.tabId, sessionAWebview.ownerId)
    onCreated?.(sessionBWebview, sessionBWebview.tabId, sessionBWebview.ownerId)

    const socketPath = join(userDataPath, 'browser-backend.sock')
    await expect(sendCommand(socketPath, {
      id: 'list-a',
      ownerId: 'chat:session-a',
      type: 'tabs_list',
    })).resolves.toEqual({
      id: 'list-a',
      ok: true,
      data: {
        tabs: [{ id: 'tab-a', url: 'https://a.example.test/', title: 'chat:session-a' }],
      },
    })

    await expect(sendCommand(socketPath, {
      id: 'navigate-a',
      ownerId: 'chat:session-a',
      type: 'navigate',
      url: 'https://a-next.example.test/',
    })).resolves.toEqual({
      id: 'navigate-a',
      ok: true,
      data: { url: 'https://a.example.test/', title: 'chat:session-a' },
    })
    expect(getActive).toHaveBeenCalledWith('chat:session-a')
    expect(sessionAWebview.navigate).toHaveBeenCalledWith('https://a-next.example.test/')
    expect(sessionBWebview.navigate).not.toHaveBeenCalled()

    await expect(sendCommand(socketPath, {
      id: 'close-cross-owner',
      ownerId: 'chat:session-a',
      type: 'tabs_close',
      tabId: 'tab-b',
    })).resolves.toEqual({
      id: 'close-cross-owner',
      ok: false,
      error: 'Tab tab-b not found',
    })
    expect(sessionBWebview.close).not.toHaveBeenCalled()
  })

  it('restores the previous active tab after concurrent background tab creation', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cradle-browser-use-'))
    tempDirectories.push(userDataPath)

    let onCreated: ((webview: DesktopWebview, tabId: string, ownerId: string) => void) | undefined
    let activeTabId = 'tab-existing'
    const activateTab = vi.fn(async (_ownerId: string, tabId: string) => {
      activeTabId = tabId
      return true
    })
    const requestTab = vi.fn(async (_ownerId: string, url?: string) => {
      const tabId = url?.includes('second') ? 'tab-second' : 'tab-first'
      const webview: DesktopWebview = {
        ownerId: 'chat:session-a',
        tabId,
        isDestroyed: () => false,
        navigate: async () => {},
        getUrl: () => url ?? 'about:blank',
        getTitle: () => tabId,
        capturePng: async () => new Uint8Array(),
        close: vi.fn(),
        onDestroyed: () => ({ dispose: () => {} }),
        cdp: {
          attach: vi.fn(),
          detach: vi.fn(),
          sendCommand: async <T>() => undefined as T,
          onDetached: () => ({ dispose: () => {} }),
        },
      }
      queueMicrotask(() => onCreated?.(webview, tabId, webview.ownerId))
      return tabId
    })
    const context: DesktopPluginContext = {
      userDataPath,
      subscriptions: [],
      webviews: {
        onCreated(handler) {
          onCreated = handler
          return { dispose: () => {} }
        },
      },
      browserTabs: {
        request: requestTab,
        activate: activateTab,
        goOffScreen: async () => false,
        getActive: async () => activeTabId,
      },
      sharedConfig: { set: vi.fn() },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      manifest: {
        name: '@cradle/browser-use',
        version: '0.0.1',
        packageDir: userDataPath,
        cradle: {
          apiVersion: '1',
          contributes: { capabilities: [], permissions: [] },
        },
      },
    }
    await activate(context)

    const socketPath = join(userDataPath, 'browser-backend.sock')
    const [first, second] = await Promise.all([
      sendCommand(socketPath, {
        id: 'new-first',
        ownerId: 'chat:session-a',
        type: 'tabs_new',
        url: 'https://first.example.test/',
      }),
      sendCommand(socketPath, {
        id: 'new-second',
        ownerId: 'chat:session-a',
        type: 'tabs_new',
        url: 'https://second.example.test/',
      }),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(requestTab).toHaveBeenCalledTimes(2)
    expect(activateTab).toHaveBeenCalledTimes(2)
    expect(activateTab).toHaveBeenNthCalledWith(1, 'chat:session-a', 'tab-existing')
    expect(activateTab).toHaveBeenNthCalledWith(2, 'chat:session-a', 'tab-existing')
    expect(activeTabId).toBe('tab-existing')
  })
})
