import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { PluginManifest, PluginSourceProvenance } from '@cradle/plugin-sdk'
import { parseCradlePluginPackageJsonText } from '@cradle/plugin-sdk/manifest'

import { readPluginInstallProvenance } from './install-receipt'

export interface DiscoveredPluginPackage {
  packageDir: string
  manifest?: PluginManifest
  provenance?: PluginSourceProvenance
  error?: string
}

/**
 * Discover plugins from the plugins/ directory.
 * Reads each subdirectory's package.json for a "cradle" field.
 */
export async function discoverPlugins(pluginsDir: string): Promise<PluginManifest[]> {
  const packages = await discoverPluginPackages(pluginsDir)
  return packages.flatMap(pkg => pkg.manifest ? [pkg.manifest] : [])
}

export async function discoverPluginPackages(pluginsDir: string): Promise<DiscoveredPluginPackage[]> {
  const packages: DiscoveredPluginPackage[] = []

  let entries: Dirent[]
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true })
  }
 catch {
    return [] // plugins dir doesn't exist
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) { continue }
    const name = String(entry.name)
    const packageDir = resolve(pluginsDir, name)
    const pkgPath = resolve(pluginsDir, name, 'package.json')
    try {
      const raw = await readFile(pkgPath, 'utf-8')
      const pkg = parseCradlePluginPackageJsonText(raw)
      const manifest = {
        name: pkg.name,
        version: pkg.version,
        packageDir,
        cradle: pkg.cradle,
      }
      packages.push({
        packageDir,
        manifest,
        provenance: await readPluginInstallProvenance(packageDir, {
          packageName: manifest.name,
          version: manifest.version,
        }),
      })
    }
 catch (err) {
      packages.push({
        packageDir,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return packages
}
