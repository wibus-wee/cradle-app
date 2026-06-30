/* Resolves desktop plugin directories across dev, bundled, and operator-configured runtimes. */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { z } from 'zod'

const WORKSPACE_MARKER_FILE = 'pnpm-workspace.yaml'
const PLUGINS_DIR_NAME = 'plugins'
const SERVER_RESOURCE_DIR_NAME = 'server'
const WORKSPACE_SCAN_DEPTH = 12

interface DesktopPluginDirOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  isDev: boolean
  moduleDir?: string
  resourcesPath?: string
}

const ConfiguredPluginDirSchema = z.string()
  .trim()
  .min(1)
  .transform(value => resolve(value))
  .optional()

function findWorkspacePluginsDir(anchors: string[]): string | undefined {
  for (const anchor of anchors) {
    let current = resolve(anchor)
    for (let depth = 0; depth <= WORKSPACE_SCAN_DEPTH; depth += 1) {
      const workspaceMarker = resolve(current, WORKSPACE_MARKER_FILE)
      const pluginsDir = resolve(current, PLUGINS_DIR_NAME)
      if (existsSync(workspaceMarker) && existsSync(pluginsDir)) {
        return pluginsDir
      }

      const parent = dirname(current)
      if (parent === current) { break }
      current = parent
    }
  }

  return undefined
}

export function readConfiguredPrimaryPluginsDir(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return ConfiguredPluginDirSchema.parse(env.CRADLE_PLUGINS_DIR)
}

export function resolveDesktopPrimaryPluginsDir(options: DesktopPluginDirOptions): string {
  const env = options.env ?? process.env
  const configuredDir = readConfiguredPrimaryPluginsDir(env)
  if (configuredDir) { return configuredDir }

  if (!options.isDev) {
    const resourcesPath = options.resourcesPath ?? (process as { resourcesPath?: string }).resourcesPath
    return resolve(resourcesPath ?? process.cwd(), SERVER_RESOURCE_DIR_NAME, PLUGINS_DIR_NAME)
  }

  const anchors = [
    options.cwd ?? process.cwd(),
    options.moduleDir ?? __dirname,
  ]
  return findWorkspacePluginsDir(anchors) ?? resolve(options.cwd ?? process.cwd(), PLUGINS_DIR_NAME)
}

export function resolveDesktopPrimaryPluginsSourceKind(
  options: Pick<DesktopPluginDirOptions, 'env' | 'isDev'>,
): 'workspaceDev' | 'bundledResource' | 'externalLocal' {
  const env = options.env ?? process.env
  if (readConfiguredPrimaryPluginsDir(env)) { return 'externalLocal' }
  return options.isDev ? 'workspaceDev' : 'bundledResource'
}
