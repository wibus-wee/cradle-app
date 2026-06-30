/* Verifies desktop plugin activation and shutdown cleanup behavior. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp/cradle-user-data'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
}))

vi.mock('electron', () => electronMocks)

let tempPluginsDir: string | undefined

interface DesktopPluginPackageOptions {
  contributes?: Record<string, unknown>
  desktopSource?: string[]
}

async function writeDesktopPluginPackage(options: DesktopPluginPackageOptions = {}): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-desktop-plugin-loader-'))
  const pluginDir = join(pluginsRoot, 'cleanup-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/desktop-cleanup',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        desktop: 'desktop.mjs',
        contributes: options.contributes ?? {
          capabilities: [
            {
              id: 'desktop.shared-config.cleanup-socket',
              type: 'desktop.sharedConfigEndpoint',
              layer: 'desktop',
              permissions: [],
            },
            {
              id: 'desktop.webview-listener',
              type: 'desktop.webviewListener',
              layer: 'desktop',
              permissions: [],
            },
          ],
          permissions: [],
        },
      },
    }),
  )
  await writeFile(
    join(pluginDir, 'desktop.mjs'),
    (options.desktopSource ?? [
      'export function activate(ctx) {',
      '  ctx.sharedConfig.set("CLEANUP_SOCKET", "/tmp/socket")',
      '  ctx.webviews.onCreated(() => {})',
      '}',
    ]).join('\n'),
  )
  return pluginsRoot
}

interface CapturedWebviewShape {
  tabId: string
  url: string
  title: string
  hasRawDebugger: boolean
  hasCdp: boolean
}

function readCapturedWebviewShape(): CapturedWebviewShape | undefined {
  return (globalThis as { __desktopWebviewShape?: CapturedWebviewShape }).__desktopWebviewShape
}

function createRendererWindow(url: string, tabId: string) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      getURL: vi.fn(() => url),
      executeJavaScript: vi.fn(async () => tabId),
    },
  }
}

describe('desktop plugin loader lifecycle', () => {
  afterEach(async () => {
    const { deactivateDesktopPlugins } = await import('./plugin-loader')
    await deactivateDesktopPlugins()
    delete process.env.CRADLE_PLUGINS_DIR
    delete process.env.CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    delete process.env.ELECTRON_RENDERER_URL
    delete process.env.CRADLE_PLUGIN_ALLOWED_PERMISSIONS
    delete process.env.CRADLE_PLUGIN_ALLOWED_DESKTOP_CLEANUP_PERMISSIONS
    delete (globalThis as { __desktopWebviewShape?: CapturedWebviewShape }).__desktopWebviewShape
    delete (globalThis as { __browserTabRequestResult?: string }).__browserTabRequestResult
    vi.resetModules()
    if (tempPluginsDir) {
      await rm(tempPluginsDir, { recursive: true, force: true })
      tempPluginsDir = undefined
    }
  })

  it('disposes webview listeners, shared config, and capability records on deactivate', async () => {
    tempPluginsDir = await writeDesktopPluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'

    const {
      activateDesktopPlugins,
      deactivateDesktopPlugins,
      getDesktopPluginDescriptors,
      getPluginEnvVars,
    } = await import('./plugin-loader')

    await activateDesktopPlugins()

    expect(getPluginEnvVars()).toMatchObject({
      CRADLE_PLUGIN_CLEANUP_SOCKET: '/tmp/socket',
    })
    expect(getDesktopPluginDescriptors()[0]?.capabilities.map(capability => capability.type).sort()).toEqual([
      'desktop.sharedConfigEndpoint',
      'desktop.webviewListener',
    ])

    await deactivateDesktopPlugins()

    expect(getPluginEnvVars()).not.toHaveProperty('CRADLE_PLUGIN_CLEANUP_SOCKET')
    expect(getDesktopPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('disables external local desktop plugins when required permissions are not granted', async () => {
    tempPluginsDir = await writeDesktopPluginPackage({
      contributes: {
        capabilities: [
          {
            id: 'desktop.shared-config.cleanup-socket',
            type: 'desktop.sharedConfigEndpoint',
            layer: 'desktop',
            permissions: ['desktop.permission'],
          },
          {
            id: 'desktop.webview-listener',
            type: 'desktop.webviewListener',
            layer: 'desktop',
            permissions: ['desktop.permission'],
          },
        ],
        permissions: [{
          id: 'desktop.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'

    const {
      activateDesktopPlugins,
      getDesktopPluginDescriptors,
      getPluginEnvVars,
    } = await import('./plugin-loader')

    await activateDesktopPlugins()

    const descriptor = getDesktopPluginDescriptors().find(plugin => plugin.identity === '@cradle/desktop-cleanup')
    expect(descriptor?.layers.desktop.status).toBe('disabled')
    expect(descriptor?.layers.desktop.error).toContain('Missing required plugin permission grants: desktop.permission')
    expect(getPluginEnvVars()).not.toHaveProperty('CRADLE_PLUGIN_CLEANUP_SOCKET')
  })

  it('activates external local desktop plugins when required permissions are granted', async () => {
    tempPluginsDir = await writeDesktopPluginPackage({
      contributes: {
        capabilities: [
          {
            id: 'desktop.shared-config.cleanup-socket',
            type: 'desktop.sharedConfigEndpoint',
            layer: 'desktop',
            permissions: ['desktop.permission'],
          },
          {
            id: 'desktop.webview-listener',
            type: 'desktop.webviewListener',
            layer: 'desktop',
            permissions: ['desktop.permission'],
          },
        ],
        permissions: [{
          id: 'desktop.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    process.env.CRADLE_PLUGIN_ALLOWED_DESKTOP_CLEANUP_PERMISSIONS = 'desktop.permission'

    const {
      activateDesktopPlugins,
      getDesktopPluginDescriptors,
      getPluginEnvVars,
    } = await import('./plugin-loader')

    await activateDesktopPlugins()

    const descriptor = getDesktopPluginDescriptors().find(plugin => plugin.identity === '@cradle/desktop-cleanup')
    expect(descriptor?.layers.desktop.status).toBe('active')
    expect(getPluginEnvVars()).toMatchObject({
      CRADLE_PLUGIN_CLEANUP_SOCKET: '/tmp/socket',
    })
  })

  it('fails external local desktop plugins that register undeclared runtime capabilities', async () => {
    tempPluginsDir = await writeDesktopPluginPackage({
      contributes: {
        capabilities: [],
        permissions: [],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'

    const {
      activateDesktopPlugins,
      getDesktopPluginDescriptors,
      getPluginEnvVars,
    } = await import('./plugin-loader')

    await activateDesktopPlugins()

    const descriptor = getDesktopPluginDescriptors().find(plugin => plugin.identity === '@cradle/desktop-cleanup')
    expect(descriptor?.layers.desktop.status).toBe('failed')
    expect(descriptor?.layers.desktop.error).toContain(
      'Runtime capability desktop.sharedConfigEndpoint:desktop.shared-config.cleanup-socket is not declared',
    )
    expect(descriptor?.capabilities).toHaveLength(0)
    expect(getPluginEnvVars()).not.toHaveProperty('CRADLE_PLUGIN_CLEANUP_SOCKET')
  })

  it('passes a typed desktop webview facade instead of raw Electron WebContents', async () => {
    tempPluginsDir = await writeDesktopPluginPackage({
      desktopSource: [
        'export function activate(ctx) {',
        '  ctx.webviews.onCreated((webview, tabId) => {',
        '    globalThis.__desktopWebviewShape = {',
        '      tabId,',
        '      url: webview.getUrl(),',
        '      title: webview.getTitle(),',
        '      hasRawDebugger: "debugger" in webview,',
        '      hasCdp: typeof webview.cdp?.sendCommand === "function",',
        '    }',
        '  })',
        '}',
      ],
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'

    const {
      activateDesktopPlugins,
      notifyWebviewCreated,
    } = await import('./plugin-loader')

    await activateDesktopPlugins()

    notifyWebviewCreated({
      isDestroyed: () => false,
      loadURL: vi.fn(),
      getURL: () => 'https://example.test/',
      getTitle: () => 'Example',
      capturePage: vi.fn(),
      close: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      debugger: {
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    } as unknown as Electron.WebContents, 'renderer-tab-1')

    expect(readCapturedWebviewShape()).toEqual({
      tabId: 'renderer-tab-1',
      url: 'https://example.test/',
      title: 'Example',
      hasRawDebugger: false,
      hasCdp: true,
    })
  })

  it('routes browser tab requests to the focused renderer window before the main chat window', async () => {
    const mainWindow = createRendererWindow('http://localhost:5173/#/chat/session-main', 'main-tab')
    const tearoffWindow = createRendererWindow(
      'http://localhost:5173/tearoff.html?session=session-tearoff&tearoff=true',
      'tearoff-tab',
    )
    electronMocks.BrowserWindow.getAllWindows.mockReturnValue([mainWindow, tearoffWindow] as never)
    electronMocks.BrowserWindow.getFocusedWindow.mockReturnValue(tearoffWindow as never)

    tempPluginsDir = await writeDesktopPluginPackage({
      desktopSource: [
        'export async function activate(ctx) {',
        '  globalThis.__browserTabRequestResult = await ctx.browserTabs.request("https://example.test/")',
        '}',
      ],
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'

    const { activateDesktopPlugins } = await import('./plugin-loader')

    await activateDesktopPlugins()

    expect(tearoffWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      'globalThis.__cradleBrowserUseCreateTab("https://example.test/")',
      true,
    )
    expect(mainWindow.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect((globalThis as { __browserTabRequestResult?: string }).__browserTabRequestResult).toBe('tearoff-tab')
  })
})
