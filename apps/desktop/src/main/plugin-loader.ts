import { delimiter, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Disposable, PluginCapabilityRecord, PluginDescriptor, PluginManifest } from '@cradle/plugin-sdk'
import type { DesktopPluginContext, DesktopWebview } from '@cradle/plugin-sdk/desktop'
import { evaluatePluginPermissionPolicy, evaluatePluginRuntimeCapabilityPolicy } from '@cradle/plugin-sdk/permissions'
import { app, BrowserWindow } from 'electron'
import { z } from 'zod'

import type { DesktopPluginSource } from './plugin-discovery'
import { discoverDesktopPlugins } from './plugin-discovery'
import { resolveDesktopInstalledPluginsDir } from './plugin-install-links'
import { resolveDesktopPrimaryPluginsDir, resolveDesktopPrimaryPluginsSourceKind } from './plugin-paths'

/** Shared config written by desktop plugins, consumed as env vars by server */
const pluginSharedConfig = new Map<string, string>()

/** Active plugin deactivators */
const activePlugins = new Map<string, { deactivate?: () => void | Promise<void>, subscriptions: Disposable[] }>()

/** Webview creation listeners from plugins */
const webviewListeners: Array<(webview: DesktopWebview, tabId: string) => void> = []

/** Governed desktop plugin projection */
const desktopPluginDescriptors = new Map<string, PluginDescriptor>()
const invalidDesktopPluginDescriptors: PluginDescriptor[] = []
const ExternalPluginDirsSchema = z.array(z.string().default(''))
  .transform(values => values.flatMap(value => value.split(delimiter).map(dir => dir.trim()).filter(Boolean)))

const DesktopPluginFunctionSchema = z.function({
  input: [z.unknown()],
  output: z.unknown(),
})

const DesktopPluginModuleSchema = z.object({
  activate: DesktopPluginFunctionSchema,
  deactivate: DesktopPluginFunctionSchema.optional(),
}).passthrough()

const BrowserTabIdSchema = z.string()
const BrowserTabLookupSchema = z.string().optional()
const BrowserTabActivationSchema = z.boolean()

let capabilitySequence = 0

function isUsableRendererWindow(window: BrowserWindow | null | undefined): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed())
}

function selectActiveRendererWindow(): BrowserWindow | null {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (isUsableRendererWindow(focusedWindow)) {
    return focusedWindow
  }

  const windows = BrowserWindow.getAllWindows().filter(isUsableRendererWindow)
  return windows.find(window => window.webContents.getURL().includes('/#/chat/'))
    ?? windows[0]
    ?? null
}

async function executeBrowserTabBridge<T>(
  script: string,
  schema: z.ZodType<T>,
  actionLabel: string,
): Promise<T> {
  const window = selectActiveRendererWindow()
  if (!window) {
    throw new Error(`No renderer window available for browser tab ${actionLabel}`)
  }
  return schema.parse(await window.webContents.executeJavaScript(script, true))
}

function cloneDescriptor(descriptor: PluginDescriptor): PluginDescriptor {
  return {
    ...descriptor,
    source: { ...descriptor.source },
    layers: {
      server: { ...descriptor.layers.server },
      web: { ...descriptor.layers.web },
      desktop: { ...descriptor.layers.desktop },
    },
    capabilities: descriptor.capabilities.map(capability => ({
      ...capability,
      metadata: capability.metadata ? { ...capability.metadata } : undefined,
    })),
    declaredCapabilities: descriptor.declaredCapabilities.map(capability => ({
      ...capability,
      permissions: [...capability.permissions],
      metadata: capability.metadata ? { ...capability.metadata } : undefined,
    })),
    declaredPermissions: descriptor.declaredPermissions.map(permission => ({ ...permission })),
    warnings: [...descriptor.warnings],
  }
}

/** Get the desktop-side governed plugin projection. */
export function getDesktopPluginDescriptors(): PluginDescriptor[] {
  return [
    ...invalidDesktopPluginDescriptors.map(cloneDescriptor),
    ...Array.from(desktopPluginDescriptors.values(), cloneDescriptor),
  ]
}

/** Get plugin env vars to pass to the forked server process */
export function getPluginEnvVars(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of pluginSharedConfig) {
    env[`CRADLE_PLUGIN_${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`] = value
  }
  return env
}

/** Notify all desktop plugins about a new webview */
export function notifyWebviewCreated(wc: Electron.WebContents, tabId: string): void {
  const webview = createDesktopWebviewFacade(wc, tabId)
  for (const listener of webviewListeners) {
    try {
      listener(webview, tabId)
    }
 catch (err) {
      console.error('[plugin-loader] webview listener error:', err)
    }
  }
}

function createDesktopWebviewFacade(wc: Electron.WebContents, tabId: string): DesktopWebview {
  return {
    tabId,
    isDestroyed: () => wc.isDestroyed(),
    navigate: async (url: string) => {
      await wc.loadURL(url)
    },
    getUrl: () => wc.getURL(),
    getTitle: () => wc.getTitle(),
    capturePng: async () => wc.capturePage().then(image => image.toPNG()),
    close: () => wc.close(),
    onDestroyed(handler: () => void): Disposable {
      wc.once('destroyed', handler)
      return {
        dispose() {
          wc.removeListener('destroyed', handler)
        },
      }
    },
    cdp: {
      attach: (protocolVersion = '1.3') => wc.debugger.attach(protocolVersion),
      detach: () => wc.debugger.detach(),
      sendCommand: (command, params) => wc.debugger.sendCommand(command, params),
      onDetached(handler: (reason: string) => void): Disposable {
        const listener = (_event: Electron.Event, reason: string) => handler(reason)
        wc.debugger.on('detach', listener)
        return {
          dispose() {
            wc.debugger.removeListener('detach', listener)
          },
        }
      },
    },
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function setDesktopLayerStatus(
  descriptor: PluginDescriptor,
  status: PluginDescriptor['layers']['desktop']['status'],
  error?: string,
): void {
  descriptor.layers.desktop = {
    ...descriptor.layers.desktop,
    status,
    error,
    activatedAt: status === 'active' ? new Date().toISOString() : descriptor.layers.desktop.activatedAt,
  }
}

function removeCapabilityRecord(descriptor: PluginDescriptor, capabilityId: string): void {
  const index = descriptor.capabilities.findIndex(capability => capability.id === capabilityId)
  if (index >= 0) {
    descriptor.capabilities.splice(index, 1)
  }
}

interface DesktopCapabilityRegistration {
  capabilityId: string
  type: string
  localId: string
  label?: string
  metadata?: Record<string, unknown>
  candidateDeclaredLocalIds?: string[]
}

function registerDesktopCapability(
  descriptor: PluginDescriptor,
  registration: DesktopCapabilityRegistration,
): PluginCapabilityRecord {
  const policy = evaluatePluginRuntimeCapabilityPolicy(descriptor, {
    type: registration.type,
    layer: 'desktop',
    localId: registration.localId,
    candidateDeclaredLocalIds: registration.candidateDeclaredLocalIds,
  })
  if (!policy.allowed) {
    throw new Error(policy.reason ?? `Runtime capability ${registration.type}:${registration.localId} is not allowed.`)
  }
  if (policy.warning && !descriptor.warnings.includes(policy.warning)) {
    descriptor.warnings.push(policy.warning)
  }

  const record: PluginCapabilityRecord = {
    id: registration.capabilityId,
    owner: descriptor.identity,
    type: registration.type,
    layer: 'desktop',
    status: 'registered',
    label: registration.label,
    metadata: registration.metadata,
  }
  const existing = descriptor.capabilities.find(capability => capability.id === registration.capabilityId)
  if (existing) {
    Object.assign(existing, record)
  }
 else {
    descriptor.capabilities.push(record)
  }
  return record
}

function disposeSubscriptions(name: string, subscriptions: Disposable[]): void {
  for (const subscription of [...subscriptions].reverse()) {
    try {
      subscription.dispose()
    }
 catch (err) {
      console.error(`[plugins] error disposing ${name} desktop subscription:`, err)
    }
  }
  subscriptions.length = 0
}

function createCapabilityId(owner: string, capabilityName: string): string {
  capabilitySequence += 1
  return `${owner}:${capabilityName}:${capabilitySequence}`
}

function normalizeSharedConfigKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isRejectedDescriptor(descriptor: PluginDescriptor): boolean {
  return descriptor.layers.desktop.status === 'invalid'
    || descriptor.layers.server.status === 'invalid'
    || descriptor.layers.web.status === 'invalid'
}

function createDesktopPluginSources(isDev: boolean): DesktopPluginSource[] {
  const primaryPluginsDir = resolveDesktopPrimaryPluginsDir({ isDev, moduleDir: __dirname })
  const primarySourceKind = resolveDesktopPrimaryPluginsSourceKind({ isDev })
  const installedPluginsDir = resolveDesktopInstalledPluginsDir(app.getPath('userData'))
  const defaultSource: DesktopPluginSource = isDev
    ? {
        pluginsDir: primaryPluginsDir,
        kind: primarySourceKind,
        trusted: true,
        reason: primarySourceKind === 'externalLocal'
          ? 'Operator-configured CRADLE_PLUGINS_DIR used as the primary plugin directory'
          : 'Workspace plugin directory used by the Electron development runtime',
      }
    : {
        pluginsDir: primaryPluginsDir,
        kind: primarySourceKind,
        trusted: true,
        reason: primarySourceKind === 'externalLocal'
          ? 'Operator-configured CRADLE_PLUGINS_DIR used as the primary plugin directory'
          : 'Bundled plugin resource directory shipped with the desktop app',
      }

  const externalDirs = [
    process.env.CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS,
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
  ]
  const parsedExternalDirs = ExternalPluginDirsSchema.parse(externalDirs)

  const externalSources = parsedExternalDirs.map<DesktopPluginSource>(pluginsDir => ({
    pluginsDir,
    kind: 'externalLocal',
    trusted: true,
    reason: 'Operator-configured trusted local plugin directory; no sandbox isolation is implied',
  }))

  return [
    defaultSource,
    {
      pluginsDir: installedPluginsDir,
      kind: 'externalLocal',
      trusted: true,
      reason: 'Cradle Marketplace installed plugin directory owned by the desktop runtime',
      trustMarketplaceGrants: true,
    },
    ...externalSources,
  ]
}

function createDesktopPluginContext(manifest: PluginManifest): DesktopPluginContext {
  const descriptor = desktopPluginDescriptors.get(manifest.name)
  const subscriptions: Disposable[] = []
  const sharedConfigDisposables = new Map<string, Disposable>()
  const track = (disposable: Disposable): Disposable => {
    subscriptions.push(disposable)
    return disposable
  }
  const logger = {
    info: (msg: string, ...args: unknown[]) => console.log(`[plugin:${manifest.name}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[plugin:${manifest.name}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[plugin:${manifest.name}]`, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(`[plugin:${manifest.name}]`, msg, ...args),
  }

  return {
    userDataPath: app.getPath('userData'),
    subscriptions,
    webviews: {
      onCreated(handler: (webview: DesktopWebview, tabId: string) => void): Disposable {
        const listener = handler
        const capabilityId = createCapabilityId(manifest.name, 'desktop.webview-listener')
        if (descriptor) {
          registerDesktopCapability(descriptor, {
            capabilityId,
            type: 'desktop.webviewListener',
            localId: 'desktop.webview-listener',
            label: 'Webview creation listener',
            candidateDeclaredLocalIds: ['desktop.webview-listener'],
          })
        }
        webviewListeners.push(listener)
        return track({
          dispose() {
            const idx = webviewListeners.indexOf(listener)
            if (idx >= 0) { webviewListeners.splice(idx, 1) }
            if (descriptor) {
              removeCapabilityRecord(descriptor, capabilityId)
            }
          },
        })
      },
    },
    browserTabs: {
      async request(url?: string): Promise<string | undefined> {
        return executeBrowserTabBridge(
          `globalThis.__cradleBrowserUseCreateTab(${JSON.stringify(url)})`,
          BrowserTabIdSchema,
          'creation',
        )
      },
      async activate(tabId: string): Promise<boolean> {
        return executeBrowserTabBridge(
          `globalThis.__cradleBrowserUseActivateTab(${JSON.stringify(tabId)})`,
          BrowserTabActivationSchema,
          'activation',
        )
      },
      async goOffScreen(tabId?: string): Promise<boolean> {
        return executeBrowserTabBridge(
          `globalThis.__cradleBrowserUseGoOffScreen(${JSON.stringify(tabId)})`,
          BrowserTabActivationSchema,
          'hiding',
        )
      },
      async getActive(): Promise<string | undefined> {
        return executeBrowserTabBridge(
          'globalThis.__cradleBrowserUseGetActiveTab()',
          BrowserTabLookupSchema,
          'lookup',
        )
      },
    },
    sharedConfig: {
      set(key: string, value: string) {
        const normalizedKey = normalizeSharedConfigKey(key)
        const localId = normalizedKey ? `desktop.shared-config.${normalizedKey}` : 'desktop.shared-config'
        const capabilityId = `${manifest.name}:desktop.shared-config:${key}`
        if (descriptor) {
          registerDesktopCapability(descriptor, {
            capabilityId,
            type: 'desktop.sharedConfigEndpoint',
            localId,
            label: key,
            metadata: {
              envVar: `CRADLE_PLUGIN_${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`,
            },
            candidateDeclaredLocalIds: [localId],
          })
        }
        pluginSharedConfig.set(key, value)
        if (!sharedConfigDisposables.has(key)) {
          sharedConfigDisposables.set(key, track({
            dispose() {
              pluginSharedConfig.delete(key)
              sharedConfigDisposables.delete(key)
              if (descriptor) {
                removeCapabilityRecord(descriptor, capabilityId)
              }
            },
          }))
        }
      },
    },
    logger,
    manifest,
  }
}

function validatePluginModule(
  mod: unknown,
  pluginName: string,
): asserts mod is z.infer<typeof DesktopPluginModuleSchema> {
  try {
    DesktopPluginModuleSchema.parse(mod)
  }
  catch (err) {
    throw new Error(`[plugin:${pluginName}] desktop entry is not a valid plugin module: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function registerDesktopPluginDescriptor(descriptor: PluginDescriptor): void {
  if (!descriptor.identity || isRejectedDescriptor(descriptor)) {
    invalidDesktopPluginDescriptors.push(descriptor)
    return
  }
  desktopPluginDescriptors.set(descriptor.identity, descriptor)
}

export async function activateOneDesktopPlugin(manifest: PluginManifest): Promise<void> {
  if (!manifest.cradle.desktop) { return }
  if (activePlugins.has(manifest.name)) { return }

  const entryPath = resolve(manifest.packageDir, manifest.cradle.desktop)
  const descriptor = desktopPluginDescriptors.get(manifest.name)
  let subscriptions: Disposable[] = []
  if (descriptor) {
    const permissionDecision = evaluatePluginPermissionPolicy(descriptor, 'desktop', process.env)
    if (!permissionDecision.allowed) {
      setDesktopLayerStatus(descriptor, 'disabled', permissionDecision.reason)
      console.warn('[plugins] desktop plugin disabled by permission policy:', {
        plugin: manifest.name,
        missingRequiredPermissions: permissionDecision.missingRequiredPermissions,
      })
      return
    }
    setDesktopLayerStatus(descriptor, 'activating')
  }

  try {
    const mod = await import(pathToFileURL(entryPath).href)
    validatePluginModule(mod, manifest.name)

    const ctx = createDesktopPluginContext(manifest)
    subscriptions = ctx.subscriptions
    await mod.activate(ctx)

    activePlugins.set(manifest.name, {
      deactivate: mod.deactivate as (() => void | Promise<void>) | undefined,
      subscriptions: ctx.subscriptions,
    })
    if (descriptor) {
      setDesktopLayerStatus(descriptor, 'active')
    }
    console.log(`[plugins] desktop activated: ${manifest.name}`)
  }
  catch (err) {
    disposeSubscriptions(manifest.name, subscriptions)
    if (descriptor) {
      setDesktopLayerStatus(descriptor, 'failed', formatError(err))
    }
    console.error(`[plugins] failed to activate desktop plugin ${manifest.name}:`, err)
  }
}

export async function deactivateOneDesktopPlugin(
  pluginName: string,
  options: { removeDescriptor?: boolean } = {},
): Promise<void> {
  const plugin = activePlugins.get(pluginName)
  activePlugins.delete(pluginName)
  if (plugin) {
    try {
      await plugin.deactivate?.()
    }
    catch (err) {
      console.error(`[plugins] error deactivating ${pluginName}:`, err)
    }
    finally {
      disposeSubscriptions(pluginName, plugin.subscriptions)
    }
  }
  if (options.removeDescriptor !== false) {
    desktopPluginDescriptors.delete(pluginName)
  }
}

export async function discoverAndActivateDesktopPluginSource(
  source: DesktopPluginSource,
  pluginIdentities?: ReadonlySet<string>,
): Promise<void> {
  const { manifests, descriptors } = await discoverDesktopPlugins([source])
  for (const descriptor of descriptors) {
    if (pluginIdentities && !pluginIdentities.has(descriptor.identity)) { continue }
    registerDesktopPluginDescriptor(descriptor)
  }

  for (const manifest of manifests) {
    if (pluginIdentities && !pluginIdentities.has(manifest.name)) { continue }
    await activateOneDesktopPlugin(manifest)
  }
}

/**
 * Discover and activate all desktop plugins.
 * Must be called BEFORE startServer() so shared config is available for the fork.
 */
export async function activateDesktopPlugins(): Promise<void> {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const sources = createDesktopPluginSources(isDev)

  desktopPluginDescriptors.clear()
  invalidDesktopPluginDescriptors.length = 0

  const { manifests, descriptors } = await discoverDesktopPlugins(sources)
  for (const descriptor of descriptors) {
    registerDesktopPluginDescriptor(descriptor)
  }

  const desktopPlugins = manifests.filter(m => m.cradle.desktop)

  for (const manifest of desktopPlugins) {
    await activateOneDesktopPlugin(manifest)
  }
}

/** Deactivate all desktop plugins (called on app quit) */
export async function deactivateDesktopPlugins(): Promise<void> {
  for (const name of [...activePlugins.keys()]) {
    await deactivateOneDesktopPlugin(name, { removeDescriptor: false })
  }
  activePlugins.clear()
}
