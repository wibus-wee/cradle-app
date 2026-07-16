import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  PluginActivationState,
  PluginDescriptor,
  PluginLayer,
  PluginLayerState,
  PluginManifest,
  PluginSourceDescriptor,
  PluginSourceKind,
  PluginSourceProvenance,
} from '@cradle/plugin-sdk'
import { derivePluginRouteSegment, projectCradlePluginContributions } from '@cradle/plugin-sdk'
import { parseCradlePluginPackageJsonText } from '@cradle/plugin-sdk/manifest'

import { readPluginInstallProvenance } from './plugin-install-receipt'

export interface DesktopPluginSource {
  pluginsDir: string
  kind: PluginSourceKind
  trusted: boolean
  reason?: string
  trustMarketplaceGrants?: boolean
}

export interface DesktopPluginDiscoveryResult {
  manifests: PluginManifest[]
  descriptors: PluginDescriptor[]
}

interface DiscoveredPlugin {
  manifest: PluginManifest
  descriptor: PluginDescriptor
}

function createLayerState(layer: PluginLayer, entry: string | undefined): PluginLayerState {
  return {
    layer,
    status: entry ? 'discovered' : 'skipped',
    entry,
  }
}

function createInvalidLayerState(layer: PluginLayer, error: string): PluginLayerState {
  return {
    layer,
    status: 'invalid',
    error,
  }
}

function createDefaultActivationState(): PluginActivationState {
  return {
    enabled: true,
    source: 'default',
  }
}

function createSourceDescriptor(
  source: DesktopPluginSource,
  packageDir: string,
  provenance?: PluginSourceProvenance,
): PluginSourceDescriptor {
  return {
    kind: source.kind,
    packageDir,
    trusted: source.trusted,
    reason: source.reason,
    provenance,
    grantedPermissions: source.trustMarketplaceGrants ? provenance?.grantedPermissions : undefined,
  }
}

export function createDesktopPluginDescriptor(
  manifest: PluginManifest,
  source: DesktopPluginSource,
  provenance?: PluginSourceProvenance,
): PluginDescriptor {
  const cradle = manifest.cradle
  const contributions = projectCradlePluginContributions(manifest.name, cradle)

  return {
    identity: manifest.name,
    routeSegment: derivePluginRouteSegment(manifest.name),
    name: manifest.name,
    version: manifest.version,
    displayName: cradle.displayName ?? manifest.name,
    description: cradle.description,
    icon: cradle.icon,
    deployments: cradle.deployments,
    source: createSourceDescriptor(source, manifest.packageDir, provenance),
    activation: createDefaultActivationState(),
    layers: {
      server: createLayerState('server', cradle.server),
      web: createLayerState('web', cradle.web),
      desktop: createLayerState('desktop', cradle.desktop),
    },
    capabilities: [],
    declaredCapabilities: contributions.declaredCapabilities,
    declaredPermissions: contributions.declaredPermissions,
    warnings: [],
    hasWeb: Boolean(cradle.web),
    hasServer: Boolean(cradle.server),
    hasDesktop: Boolean(cradle.desktop),
    serverEntry: cradle.server,
    webEntry: cradle.web,
    desktopEntry: cradle.desktop,
  }
}

function createInvalidDescriptor(
  packageDir: string,
  source: DesktopPluginSource,
  directoryName: string,
  error: string,
): PluginDescriptor {
  return {
    identity: '',
    routeSegment: `invalid-${derivePluginRouteSegment(directoryName)}`,
    name: '',
    version: '0.0.0',
    displayName: directoryName,
    source: createSourceDescriptor(source, packageDir),
    activation: createDefaultActivationState(),
    layers: {
      server: createInvalidLayerState('server', error),
      web: createInvalidLayerState('web', error),
      desktop: createInvalidLayerState('desktop', error),
    },
    capabilities: [],
    declaredCapabilities: [],
    declaredPermissions: [],
    warnings: [error],
    hasWeb: false,
    hasServer: false,
    hasDesktop: false,
  }
}

function markInvalid(descriptor: PluginDescriptor, error: string): void {
  descriptor.layers.server = createInvalidLayerState('server', error)
  descriptor.layers.web = createInvalidLayerState('web', error)
  descriptor.layers.desktop = createInvalidLayerState('desktop', error)
  descriptor.warnings.push(error)
}

function rejectDuplicateIdentities(discovered: DiscoveredPlugin[]): Set<PluginDescriptor> {
  const invalidDescriptors = new Set<PluginDescriptor>()
  const byIdentity = new Map<string, DiscoveredPlugin[]>()
  const byRouteSegment = new Map<string, DiscoveredPlugin[]>()

  for (const plugin of discovered) {
    const identityMatches = byIdentity.get(plugin.manifest.name) ?? []
    identityMatches.push(plugin)
    byIdentity.set(plugin.manifest.name, identityMatches)

    const routeMatches = byRouteSegment.get(plugin.descriptor.routeSegment) ?? []
    routeMatches.push(plugin)
    byRouteSegment.set(plugin.descriptor.routeSegment, routeMatches)
  }

  for (const [identity, matches] of byIdentity) {
    if (matches.length <= 1) { continue }
    for (const plugin of matches) {
      markInvalid(plugin.descriptor, `Duplicate package.json#name '${identity}'`)
      invalidDescriptors.add(plugin.descriptor)
    }
  }

  for (const [routeSegment, matches] of byRouteSegment) {
    if (matches.length <= 1) { continue }
    for (const plugin of matches) {
      markInvalid(plugin.descriptor, `Route segment collision '${routeSegment}'`)
      invalidDescriptors.add(plugin.descriptor)
    }
  }

  return invalidDescriptors
}

/**
 * Discover plugins from the plugins/ directory.
 * Same logic as server-side discovery but runs in Electron main.
 */
export async function discoverPlugins(pluginsDir: string): Promise<PluginManifest[]> {
  const result = await discoverDesktopPlugins([
    {
      pluginsDir,
      kind: 'workspaceDev',
      trusted: true,
      reason: 'Legacy desktop discovery source',
    },
  ])
  return result.manifests
}

export async function discoverDesktopPlugins(sources: DesktopPluginSource[]): Promise<DesktopPluginDiscoveryResult> {
  const discovered: DiscoveredPlugin[] = []
  const diagnostics: PluginDescriptor[] = []

  for (const source of sources) {
    await discoverDesktopPluginsFromSource(source, discovered, diagnostics)
  }

  const invalidDescriptors = rejectDuplicateIdentities(discovered)
  const manifests = discovered
    .filter(plugin => !invalidDescriptors.has(plugin.descriptor))
    .map(plugin => plugin.manifest)

  return {
    manifests,
    descriptors: [...diagnostics, ...discovered.map(plugin => plugin.descriptor)],
  }
}

async function discoverDesktopPluginsFromSource(
  source: DesktopPluginSource,
  discovered: DiscoveredPlugin[],
  diagnostics: PluginDescriptor[],
): Promise<void> {
  const pluginsDir = resolve(source.pluginsDir)

  let entries: Dirent[]
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true })
  }
 catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) { continue }
    const directoryName = String(entry.name)
    const packageDir = resolve(pluginsDir, directoryName)
    const pkgPath = resolve(packageDir, 'package.json')
    try {
      const raw = await readFile(pkgPath, 'utf-8')
      const pkg = parseCradlePluginPackageJsonText(raw)

      const manifest: PluginManifest = {
        name: pkg.name,
        version: pkg.version,
        packageDir,
        cradle: pkg.cradle,
      }
      const provenance = await readPluginInstallProvenance(packageDir, {
        packageName: manifest.name,
        version: manifest.version,
      })
      discovered.push({
        manifest,
        descriptor: createDesktopPluginDescriptor(manifest, source, provenance),
      })
    }
 catch (err) {
      diagnostics.push(createInvalidDescriptor(
        packageDir,
        source,
        directoryName,
        err instanceof Error ? err.message : 'Invalid package.json',
      ))
    }
  }
}
