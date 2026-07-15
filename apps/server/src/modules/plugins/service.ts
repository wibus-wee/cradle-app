import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import type { PluginSource } from '@cradle/db'
import type {
  PluginActivationState,
  PluginCapabilityRecord,
  PluginDeclaredCapabilityRecord,
  PluginDeclaredPermissionRecord,
  PluginDescriptor,
  PluginLayer,
  PluginLayerState,
  PluginManifest,
  PluginSourceDescriptor,
} from '@cradle/plugin-sdk'

import { AppError } from '../../errors/app-error'
import { discoverPluginPackages } from '../../plugins/discovery'
import { disablePlugin, discoverAndActivateSource, enablePlugin, removeDiscoveredSource } from '../../plugins/loader'
import { classifyPluginSource, createPluginDescriptor, getPluginDescriptorByRouteSegment, listPluginDescriptors } from '../../plugins/runtime-registry'
import type { PluginSourceInstallerOptions } from '../../plugins/source-installer'
import {
  inspectPluginSourceDirectory,
  refreshPluginSourceDirectory,
  resolvePluginSourceDirectory,
} from '../../plugins/source-installer'
import type { AddPluginSourceInput } from '../../plugins/source-registry'
import { addPluginSource, deletePluginSource, listPluginSources, readPluginSource } from '../../plugins/source-registry'
import { evaluatePluginSourceTrust, readRelayHostExposure } from '../../plugins/trust-policy'

export interface PluginMentionCapability {
  id: string
  type: string
  layer: PluginLayer
  label: string | null
}

export interface PluginMentionCandidate {
  pluginName: string
  displayName: string
  description: string | null
  iconUrl: string | null
  routeSegment: string
  capabilities: PluginMentionCapability[]
  mcpServers: string[]
  active: boolean
}

export interface PluginIconAsset {
  bytes: Uint8Array
  mimeType: string
}

export interface PluginActivationView {
  enabled: boolean
  source: 'default' | 'user'
  reason: string | null
  updatedAt: number | null
}

export interface PluginLayerView {
  layer: PluginLayer
  status: PluginLayerState['status']
  entry: string | null
  error: string | null
  activatedAt: string | null
}

export interface PluginSourceView {
  kind: PluginDescriptor['source']['kind']
  packageDir: string
  trusted: boolean
  reason: string | null
  checksum: string | null
}

export interface PluginCapabilityView {
  id: string
  owner: string
  type: string
  layer: PluginLayer
  status: PluginCapabilityRecord['status']
  label: string | null
  metadata: Record<string, unknown>
}

export interface PluginDeclaredCapabilityView {
  id: string
  owner: string
  localId: string
  type: string
  layer: PluginLayer | null
  label: string | null
  description: string | null
  permissions: string[]
  metadata: Record<string, unknown>
}

export interface PluginDeclaredPermissionView {
  id: string
  owner: string
  localId: string
  label: string | null
  description: string | null
  required: boolean
}

export interface PluginDescriptorView {
  identity: string
  routeSegment: string
  name: string
  version: string
  displayName: string
  description: string | null
  iconUrl: string | null
  source: PluginSourceView
  activation: PluginActivationView
  layers: Record<PluginLayer, PluginLayerView>
  declaredCapabilities: PluginDeclaredCapabilityView[]
  declaredPermissions: PluginDeclaredPermissionView[]
  capabilities: PluginCapabilityView[]
  warnings: string[]
  active: boolean
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
  serverEntry: string | null
  webEntry: string | null
  desktopEntry: string | null
}

export interface PluginSourceRegistryEntryView {
  id: string
  kind: PluginSource['kind']
  location: string
  ref: string | null
  subPath: string | null
  label: string | null
  addedReason: string
  createdAt: number
  updatedAt: number
  resolvedDirectory: string | null
  error: string | null
  plugins: PluginDescriptorView[]
}

export interface AddPluginSourceResult {
  source: PluginSourceRegistryEntryView
  discoveredPlugins: PluginDescriptorView[]
}

export interface PluginPreviewItem {
  name: string
  version: string
  displayName: string
  description: string | null
  iconAvailable: boolean
  trusted: boolean
  trustReason: string | null
  declaredPermissions: PluginDeclaredPermissionView[]
  warnings: string[]
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
}

export interface PluginSourcePreview {
  source: { kind: 'git' | 'npm', location: string, ref: string | null, subPath: string | null }
  plugins: PluginPreviewItem[]
  warnings: string[]
}

function trimNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

const iconMimeTypesByExtension: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function toMentionCapability(
  capability: PluginCapabilityRecord | PluginDeclaredCapabilityRecord,
): PluginMentionCapability | null {
  if (!capability.layer) {
    return null
  }
  return {
    id: capability.id,
    type: capability.type,
    layer: capability.layer,
    label: capability.label ?? null,
  }
}

function readMcpServerName(capability: PluginCapabilityRecord | PluginDeclaredCapabilityRecord): string | null {
  if (capability.type !== 'mcp-server') {
    return null
  }
  if ('localId' in capability) {
    const localId = capability.localId
    return localId.startsWith('mcp.') ? localId.slice('mcp.'.length) : localId
  }
  const metadataName = typeof capability.metadata?.name === 'string' ? capability.metadata.name : null
  if (metadataName) {
    return metadataName
  }
  const localId = capability.id.startsWith(`${capability.owner}:`)
    ? capability.id.slice(capability.owner.length + 1)
    : capability.id
  return localId.startsWith('mcp-server.') ? localId.slice('mcp-server.'.length) : localId
}

function isPluginActive(descriptor: PluginDescriptor): boolean {
  return descriptor.activation.enabled && (descriptor.capabilities.length > 0
    || Object.values(descriptor.layers).some(layer => layer.status === 'active')
  )
}

function pluginIconUrl(descriptor: PluginDescriptor): string | null {
  return descriptor.icon ? `/plugins/${encodeURIComponent(descriptor.routeSegment)}/icon` : null
}

function toMentionCandidate(descriptor: PluginDescriptor): PluginMentionCandidate {
  const capabilityById = new Map<string, PluginMentionCapability>()
  for (const capability of descriptor.declaredCapabilities) {
    const mentionCapability = toMentionCapability(capability)
    if (mentionCapability) {
      capabilityById.set(mentionCapability.id, mentionCapability)
    }
  }
  for (const capability of descriptor.capabilities) {
    const mentionCapability = toMentionCapability(capability)
    if (mentionCapability) {
      capabilityById.set(mentionCapability.id, mentionCapability)
    }
  }

  const mcpServers = new Set<string>()
  for (const capability of [...descriptor.declaredCapabilities, ...descriptor.capabilities]) {
    const serverName = readMcpServerName(capability)
    if (serverName) {
      mcpServers.add(serverName)
    }
  }

  return {
    pluginName: descriptor.name,
    displayName: descriptor.displayName,
    description: descriptor.description ?? null,
    iconUrl: pluginIconUrl(descriptor),
    routeSegment: descriptor.routeSegment,
    capabilities: [...capabilityById.values()],
    mcpServers: [...mcpServers].sort(),
    active: isPluginActive(descriptor),
  }
}

export function listMentionCandidates(): PluginMentionCandidate[] {
  return listPluginDescriptors()
    .filter(descriptor => descriptor.activation.enabled)
    .map(toMentionCandidate)
    .filter(candidate => candidate.active || candidate.capabilities.length > 0)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

function toActivationView(activation: PluginActivationState): PluginActivationView {
  return {
    enabled: activation.enabled,
    source: activation.source,
    reason: activation.reason ?? null,
    updatedAt: activation.updatedAt ?? null,
  }
}

function toLayerView(layer: PluginLayerState): PluginLayerView {
  return {
    layer: layer.layer,
    status: layer.status,
    entry: layer.entry ?? null,
    error: layer.error ?? null,
    activatedAt: layer.activatedAt ?? null,
  }
}

function toCapabilityView(capability: PluginCapabilityRecord): PluginCapabilityView {
  return {
    id: capability.id,
    owner: capability.owner,
    type: capability.type,
    layer: capability.layer,
    status: capability.status,
    label: capability.label ?? null,
    metadata: capability.metadata ?? {},
  }
}

function toDeclaredCapabilityView(capability: PluginDeclaredCapabilityRecord): PluginDeclaredCapabilityView {
  return {
    id: capability.id,
    owner: capability.owner,
    localId: capability.localId,
    type: capability.type,
    layer: capability.layer ?? null,
    label: capability.label ?? null,
    description: capability.description ?? null,
    permissions: capability.permissions,
    metadata: capability.metadata ?? {},
  }
}

function toDeclaredPermissionView(permission: PluginDeclaredPermissionRecord): PluginDeclaredPermissionView {
  return {
    id: permission.id,
    owner: permission.owner,
    localId: permission.localId,
    label: permission.label ?? null,
    description: permission.description ?? null,
    required: permission.required ?? false,
  }
}

export function toPluginDescriptorView(descriptor: PluginDescriptor): PluginDescriptorView {
  return {
    identity: descriptor.identity,
    routeSegment: descriptor.routeSegment,
    name: descriptor.name,
    version: descriptor.version,
    displayName: descriptor.displayName,
    description: descriptor.description ?? null,
    iconUrl: pluginIconUrl(descriptor),
    source: {
      kind: descriptor.source.kind,
      packageDir: descriptor.source.packageDir,
      trusted: descriptor.source.trusted,
      reason: descriptor.source.reason ?? null,
      checksum: descriptor.source.checksum ?? null,
    },
    activation: toActivationView(descriptor.activation),
    layers: {
      server: toLayerView(descriptor.layers.server),
      web: toLayerView(descriptor.layers.web),
      desktop: toLayerView(descriptor.layers.desktop),
    },
    declaredCapabilities: descriptor.declaredCapabilities.map(toDeclaredCapabilityView),
    declaredPermissions: descriptor.declaredPermissions.map(toDeclaredPermissionView),
    capabilities: descriptor.capabilities.map(toCapabilityView),
    warnings: descriptor.warnings,
    active: isPluginActive(descriptor),
    hasWeb: descriptor.hasWeb,
    hasServer: descriptor.hasServer,
    hasDesktop: descriptor.hasDesktop,
    serverEntry: descriptor.serverEntry ?? null,
    webEntry: descriptor.webEntry ?? null,
    desktopEntry: descriptor.desktopEntry ?? null,
  }
}

export function listPlugins(): PluginDescriptorView[] {
  return listPluginDescriptors()
    .map(toPluginDescriptorView)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

function isPathWithin(path: string, parent: string): boolean {
  const normalizedPath = resolve(path)
  const normalizedParent = resolve(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

async function toPluginSourceRegistryEntryView(source: PluginSource): Promise<PluginSourceRegistryEntryView> {
  let resolvedDirectory: string | null = null
  let error: string | null = null
  try {
    resolvedDirectory = await inspectPluginSourceDirectory(source)
    if (!resolvedDirectory) {
      error = 'Plugin source cache is unresolved. Preview, add, or refresh the source to resolve it.'
    }
  }
  catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const plugins = resolvedDirectory
    ? listPluginDescriptors()
        .filter(descriptor => isPathWithin(descriptor.source.packageDir, resolvedDirectory))
        .map(toPluginDescriptorView)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
    : []

  return {
    id: source.id,
    kind: source.kind,
    location: source.location,
    ref: source.ref ?? null,
    subPath: source.subPath ?? null,
    label: source.label ?? null,
    addedReason: source.addedReason,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    resolvedDirectory,
    error,
    plugins,
  }
}

export async function listSources(): Promise<PluginSourceRegistryEntryView[]> {
  return Promise.all(listPluginSources().map(toPluginSourceRegistryEntryView))
}

export async function getSource(sourceId: string): Promise<PluginSourceRegistryEntryView> {
  const source = readPluginSource(sourceId)
  if (!source) {
    throw new AppError({
      code: 'plugin_source_not_found',
      status: 404,
      message: 'Plugin source not found.',
      details: { sourceId },
    })
  }
  return toPluginSourceRegistryEntryView(source)
}

export async function createSource(
  input: AddPluginSourceInput,
  options: PluginSourceInstallerOptions = {},
): Promise<AddPluginSourceResult> {
  const source = addPluginSource(input)
  try {
    const discovered = await discoverAndActivateSource(source.id, options)
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: discovered.map(toPluginDescriptorView),
    }
  }
  catch {
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: [],
    }
  }
}

/**
 * Stateless preview of a plugin source: download to the hash-keyed cache,
 * discover packages, evaluate trust, and return - **no DB row, no runtime
 * registration, no activation**. The cache is reused by a subsequent real
 * install (same `{kind,location,ref,subPath}` -> same hash -> no second fetch).
 */
export async function previewSource(
  input: AddPluginSourceInput,
  options: PluginSourceInstallerOptions = {},
): Promise<PluginSourcePreview> {
  if (input.kind !== 'git' && input.kind !== 'npm') {
    throw new AppError({
      code: 'invalid_plugin_source',
      status: 400,
      message: 'Preview only supports git and npm plugin sources.',
    })
  }
  const kind = input.kind

  const tempSource: PluginSource = {
    id: `preview:${randomUUID()}`,
    kind,
    location: input.location.trim(),
    ref: trimNullable(input.ref),
    subPath: trimNullable(input.subPath),
    label: null,
    addedReason: 'preview',
    createdAt: 0,
    updatedAt: 0,
  }

  const pluginsDir = await resolvePluginSourceDirectory(tempSource, options)
  const packages = await discoverPluginPackages(pluginsDir)
  const relayHostExposed = readRelayHostExposure()

  const plugins: PluginPreviewItem[] = []
  const warnings: string[] = []

  for (const pkg of packages) {
    const manifest: PluginManifest | undefined = pkg.manifest
    if (!manifest) {
      warnings.push(pkg.error ?? `Invalid plugin package at ${pkg.packageDir}.`)
      continue
    }

    const baseSource: PluginSourceDescriptor = {
      ...classifyPluginSource(pkg.packageDir, pluginsDir, 'externalLocal'),
      provenance: pkg.provenance,
    }

    let trustedSource: PluginSourceDescriptor
    try {
      trustedSource = await evaluatePluginSourceTrust({
        pluginName: manifest.name,
        source: baseSource,
        relayHostExposed,
      })
    }
    catch (err) {
      trustedSource = {
        ...baseSource,
        trusted: false,
        reason: err instanceof Error ? err.message : String(err),
      }
    }

    const descriptor = createPluginDescriptor(manifest, trustedSource)
    plugins.push({
      name: descriptor.name,
      version: descriptor.version,
      displayName: descriptor.displayName,
      description: descriptor.description ?? null,
      iconAvailable: !!descriptor.icon,
      trusted: trustedSource.trusted,
      trustReason: trustedSource.reason ?? null,
      declaredPermissions: descriptor.declaredPermissions.map(toDeclaredPermissionView),
      warnings: descriptor.warnings,
      hasWeb: descriptor.hasWeb,
      hasServer: descriptor.hasServer,
      hasDesktop: descriptor.hasDesktop,
    })
  }

  return {
    source: {
      kind,
      location: tempSource.location,
      ref: tempSource.ref,
      subPath: tempSource.subPath,
    },
    plugins,
    warnings,
  }
}

export async function refreshSource(
  sourceId: string,
  options: PluginSourceInstallerOptions = {},
): Promise<AddPluginSourceResult> {
  const source = readPluginSource(sourceId)
  if (!source) {
    throw new AppError({
      code: 'plugin_source_not_found',
      status: 404,
      message: 'Plugin source not found.',
      details: { sourceId },
    })
  }

  try {
    await refreshPluginSourceDirectory(source, options)
    const discovered = await discoverAndActivateSource(source.id, options)
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: discovered.map(toPluginDescriptorView),
    }
  }
  catch {
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: [],
    }
  }
}

export async function removeSource(sourceId: string): Promise<{ removed: true }> {
  const source = readPluginSource(sourceId)
  if (!source) {
    throw new AppError({
      code: 'plugin_source_not_found',
      status: 404,
      message: 'Plugin source not found.',
      details: { sourceId },
    })
  }
  await removeDiscoveredSource(source.id)
  deletePluginSource(source.id)
  return { removed: true }
}

export function getPlugin(routeSegment: string): PluginDescriptorView {
  const descriptor = getPluginDescriptorByRouteSegment(routeSegment)
  if (!descriptor) {
    throw new AppError({
      code: 'plugin_not_found',
      status: 404,
      message: 'Plugin not found.',
      details: { routeSegment },
    })
  }
  return toPluginDescriptorView(descriptor)
}

export async function setPluginEnabled(
  routeSegment: string,
  input: { enabled: boolean, reason?: string | null },
): Promise<PluginDescriptorView> {
  const descriptor = getPluginDescriptorByRouteSegment(routeSegment)
  if (!descriptor) {
    throw new AppError({
      code: 'plugin_not_found',
      status: 404,
      message: 'Plugin not found.',
      details: { routeSegment },
    })
  }

  const updated = input.enabled
    ? await enablePlugin(descriptor.identity)
    : await disablePlugin(descriptor.identity, input.reason ?? undefined)
  return toPluginDescriptorView(updated)
}

export async function readPluginIcon(routeSegment: string): Promise<PluginIconAsset> {
  const descriptor = getPluginDescriptorByRouteSegment(routeSegment)
  if (!descriptor?.icon) {
    throw new AppError({
      code: 'plugin_icon_not_found',
      status: 404,
      message: 'Plugin icon not found.',
    })
  }

  const extension = extname(descriptor.icon).toLowerCase()
  const mimeType = iconMimeTypesByExtension[extension]
  if (!mimeType) {
    throw new AppError({
      code: 'plugin_icon_unsupported',
      status: 415,
      message: 'Plugin icon type is not supported.',
      details: { routeSegment, extension },
    })
  }

  const packageDir = resolve(descriptor.source.packageDir)
  const iconPath = resolve(packageDir, descriptor.icon)
  if (iconPath !== packageDir && !iconPath.startsWith(`${packageDir}/`)) {
    throw new AppError({
      code: 'plugin_icon_path_invalid',
      status: 400,
      message: 'Plugin icon path is invalid.',
      details: { routeSegment },
    })
  }

  const info = await stat(iconPath).catch(() => null)
  if (!info?.isFile()) {
    throw new AppError({
      code: 'plugin_icon_not_found',
      status: 404,
      message: 'Plugin icon not found.',
      details: { routeSegment },
    })
  }

  return {
    bytes: await readFile(iconPath),
    mimeType,
  }
}
