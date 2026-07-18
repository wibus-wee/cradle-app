import type { Disposable } from '@cradle/plugin-sdk'
import type { PluginUninstallHandler, PluginUninstallInspection } from '@cradle/plugin-sdk/server'

const uninstallHandlers = new Map<string, PluginUninstallHandler>()

export function registerPluginUninstallHandler(owner: string, handler: PluginUninstallHandler): Disposable {
  if (uninstallHandlers.has(owner)) {
    throw new Error(`Plugin uninstall lifecycle is already registered: ${owner}`)
  }
  uninstallHandlers.set(owner, handler)
  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      if (uninstallHandlers.get(owner) === handler) {
        uninstallHandlers.delete(owner)
      }
    },
  }
}

export function hasPluginUninstallHandler(owner: string): boolean {
  return uninstallHandlers.has(owner)
}

export async function inspectPluginUninstall(owner: string): Promise<PluginUninstallInspection | null> {
  return await uninstallHandlers.get(owner)?.inspect() ?? null
}

export async function executePluginUninstall(owner: string): Promise<void> {
  const handler = uninstallHandlers.get(owner)
  if (!handler) {
    throw new Error(`Plugin does not provide a required uninstall lifecycle: ${owner}`)
  }
  await handler.execute()
}

export function resetPluginUninstallRegistry(): void {
  uninstallHandlers.clear()
}
