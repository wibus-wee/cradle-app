import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Disposable } from '@cradle/plugin-sdk'
import type { DesktopPluginContext, DesktopWebview } from '@cradle/plugin-sdk/desktop'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { activate, deactivate } from './desktop'

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

    let onCreated: ((webview: DesktopWebview, tabId: string) => void) | undefined
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

    onCreated?.(webview, webview.tabId)
    onCreated?.(webview, webview.tabId)

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
})
