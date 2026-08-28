import { createHash, randomUUID } from 'node:crypto'
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
import {
  disablePlugin,
  discoverAndActivateSource,
  enablePlugin,
  inspectDiscoveredSourceRemoval,
  rediscoverAndActivateSource,
  removeDiscoveredSource,
} from '../../plugins/loader'
import { classifyPluginSource, createPluginDescriptor, getPluginDescriptorByRouteSegment, listPluginDescriptors } from '../../plugins/runtime-registry'
import type { PluginSourceInstallerOptions } from '../../plugins/source-installer'
import {
  deletePluginSourceCache,
  inspectPluginSourceDirectory,
  refreshPluginSourceDirectory,
  resolvePluginSourceDirectory,
} from '../../plugins/source-installer'
import type { AddPluginSourceInput } from '../../plugins/source-registry'
import { addPluginSource, deletePluginSource, listPluginSources, readPluginSource, touchPluginSource } from '../../plugins/source-registry'
import { evaluatePluginSourceTrust, readFabricNodeExposure } from '../../plugins/trust-policy'
import { pluginLifecycle } from './lifecycle-service'

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
  grantedPermissions: string[]
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
  operation: PluginSourceOperationView
}

export interface PluginSourceOperationView {
  action: 'install' | 'update' | 'refresh'
  status: 'success' | 'failed'
  error: string | null
  reviewRequired: boolean
  reviewPath: string | null
  previousSnapshotPreserved: boolean
}

export interface PluginOperationContext {
  chatSessionId?: string | null
}

export interface PendingPluginReviewView {
  sourceId: string
  createdAt: number
  source: PluginSourceRegistryEntryView
}

function sourceOperation(
  action: PluginSourceOperationView['action'],
  plugins: PluginDescriptor[],
  previousSnapshotPreserved: boolean,
  error: string | null = null,
): PluginSourceOperationView {
  const reviewRequired = plugins.some(plugin => plugin.source.kind === 'externalLocal' && !plugin.source.trusted)
  return {
    action,
    status: error ? 'failed' : 'success',
    error,
    reviewRequired,
    reviewPath: reviewRequired ? '/plugins' : null,
    previousSnapshotPreserved,
  }
}

function publishSourceLifecycle(
  type: 'source-installed' | 'source-updated' | 'source-refreshed',
  sourceId: string,
  plugins: PluginDescriptor[],
  context: PluginOperationContext,
  previousPluginIdentities: string[] = [],
): void {
  pluginLifecycle.publish({
    type,
    sourceId,
    pluginIdentities: [
      ...previousPluginIdentities,
      ...plugins.map(plugin => plugin.identity),
    ],
    chatSessionId: plugins.some(plugin => plugin.source.kind === 'externalLocal' && !plugin.source.trusted)
      ? context.chatSessionId ?? null
      : null,
  })
}

export type PluginSourceRemovalPlanView = Awaited<ReturnType<typeof inspectDiscoveredSourceRemoval>> & {
  confirmationToken: string
  expiresAt: string
}

interface PendingSourceRemoval {
  sourceId: string
  digest: string
  expiresAt: number
}

const SOURCE_REMOVAL_CONFIRMATION_TTL_MS = 5 * 60 * 1000
const pendingSourceRemovals = new Map<string, PendingSourceRemoval>()
const activeSourceRemovals = new Set<string>()

function removalPlanDigest(plan: Awaited<ReturnType<typeof inspectDiscoveredSourceRemoval>>): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

function pruneSourceRemovalConfirmations(now = Date.now()): void {
  for (const [token, pending] of pendingSourceRemovals) {
    if (pending.expiresAt <= now) { pendingSourceRemovals.delete(token) }
  }
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
      grantedPermissions: descriptor.source.grantedPermissions ?? [],
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
  context: PluginOperationContext = {},
): Promise<AddPluginSourceResult> {
  const source = addPluginSource(input)
  try {
    const discovered = await discoverAndActivateSource(source.id, options)
    const result = {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: discovered.map(toPluginDescriptorView),
      operation: sourceOperation('install', discovered, false),
    }
    publishSourceLifecycle('source-installed', source.id, discovered, context)
    return result
  }
  catch (error) {
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: [],
      operation: sourceOperation('install', [], false, error instanceof Error ? error.message : String(error)),
    }
  }
}

function requireAbsolutePackageDir(packageDir: string): string {
  const absolutePackageDir = resolve(packageDir)
  if (absolutePackageDir !== packageDir) {
    throw new AppError({
      code: 'plugin_package_dir_not_absolute',
      status: 400,
      message: 'Personal plugin packageDir must be an absolute path.',
    })
  }
  return absolutePackageDir
}

export async function installPersonalPlugin(
  input: { packageDir: string, label?: string | null, addedReason?: string | null },
  options: PluginSourceInstallerOptions = {},
  context: PluginOperationContext = {},
): Promise<AddPluginSourceResult> {
  const packageDir = requireAbsolutePackageDir(input.packageDir)
  const duplicate = listPluginSources().find(source => source.kind === 'personal' && source.location === packageDir)
  if (duplicate) {
    throw new AppError({
      code: 'personal_plugin_already_installed',
      status: 409,
      message: 'This personal plugin source is already installed. Update its existing source instead.',
      details: { sourceId: duplicate.id },
    })
  }

  const source = addPluginSource({
    kind: 'personal',
    location: packageDir,
    label: input.label,
    addedReason: input.addedReason ?? 'Built and installed as a personal plugin.',
  })
  try {
    await refreshPluginSourceDirectory(source, options)
    const discovered = await discoverAndActivateSource(source.id, options)
    const result = {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: discovered.map(toPluginDescriptorView),
      operation: sourceOperation('install', discovered, false),
    }
    publishSourceLifecycle('source-installed', source.id, discovered, context)
    return result
  }
  catch (error) {
    await deletePluginSourceCache(source).catch(() => undefined)
    deletePluginSource(source.id)
    throw error
  }
}

export async function updatePersonalPlugin(
  sourceId: string,
  input: { packageDir: string },
  options: PluginSourceInstallerOptions = {},
  context: PluginOperationContext = {},
): Promise<AddPluginSourceResult> {
  const source = readPluginSource(sourceId)
  if (!source || source.kind !== 'personal') {
    throw new AppError({
      code: 'personal_plugin_source_not_found',
      status: 404,
      message: 'Personal plugin source not found.',
      details: { sourceId },
    })
  }
  const packageDir = requireAbsolutePackageDir(input.packageDir)
  if (packageDir !== source.location) {
    throw new AppError({
      code: 'personal_plugin_source_mismatch',
      status: 409,
      message: 'Update packageDir must match the retained source directory used during installation.',
      details: { sourceId, expectedPackageDir: source.location },
    })
  }

  const previousPluginIdentities = (await toPluginSourceRegistryEntryView(source)).plugins.map(plugin => plugin.identity)
  let discovered: PluginDescriptor[]
  try {
    await refreshPluginSourceDirectory(source, options)
  }
  catch (error) {
    throw new AppError({
      code: 'personal_plugin_update_failed',
      status: error instanceof AppError ? error.status : 500,
      message: error instanceof Error ? error.message : 'Personal plugin update failed.',
      details: { sourceId, previousSnapshotPreserved: true },
    })
  }
  try {
    discovered = await rediscoverAndActivateSource(source.id, options)
  }
  catch (error) {
    pluginLifecycle.clearPendingReview(sourceId)
    pluginLifecycle.publish({
      type: 'source-updated',
      sourceId,
      pluginIdentities: previousPluginIdentities,
      chatSessionId: null,
    })
    throw new AppError({
      code: 'personal_plugin_activation_failed',
      status: error instanceof AppError ? error.status : 500,
      message: error instanceof Error ? error.message : 'Personal plugin activation failed.',
      details: { sourceId, previousSnapshotPreserved: false },
    })
  }
  touchPluginSource(source.id)
  const updatedSource = readPluginSource(source.id)!
  const result = {
    source: await toPluginSourceRegistryEntryView(updatedSource),
    discoveredPlugins: discovered.map(toPluginDescriptorView),
    operation: sourceOperation('update', discovered, false),
  }
  publishSourceLifecycle('source-updated', source.id, discovered, context, previousPluginIdentities)
  return result
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
  const fabricNodeExposed = readFabricNodeExposure()

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
        fabricNodeExposed,
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
  context: PluginOperationContext = {},
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

  const previousPluginIdentities = (await toPluginSourceRegistryEntryView(source)).plugins.map(plugin => plugin.identity)
  try {
    await refreshPluginSourceDirectory(source, options)
  }
  catch (error) {
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: [],
      operation: sourceOperation('refresh', [], true, error instanceof Error ? error.message : String(error)),
    }
  }
  let discovered: PluginDescriptor[]
  try {
    discovered = await rediscoverAndActivateSource(source.id, options)
  }
  catch (error) {
    pluginLifecycle.clearPendingReview(sourceId)
    pluginLifecycle.publish({
      type: 'source-refreshed',
      sourceId,
      pluginIdentities: previousPluginIdentities,
      chatSessionId: null,
    })
    return {
      source: await toPluginSourceRegistryEntryView(source),
      discoveredPlugins: [],
      operation: sourceOperation('refresh', [], false, error instanceof Error ? error.message : String(error)),
    }
  }
  touchPluginSource(source.id)
  const updatedSource = readPluginSource(source.id)!
  const result = {
    source: await toPluginSourceRegistryEntryView(updatedSource),
    discoveredPlugins: discovered.map(toPluginDescriptorView),
    operation: sourceOperation('refresh', discovered, false),
  }
  publishSourceLifecycle('source-refreshed', source.id, discovered, context, previousPluginIdentities)
  return result
}

export async function inspectSourceRemoval(sourceId: string): Promise<PluginSourceRemovalPlanView> {
  const source = readPluginSource(sourceId)
  if (!source) {
    throw new AppError({
      code: 'plugin_source_not_found',
      status: 404,
      message: 'Plugin source not found.',
      details: { sourceId },
    })
  }

  pruneSourceRemovalConfirmations()
  const plan = await inspectDiscoveredSourceRemoval(source.id)
  const confirmationToken = randomUUID()
  const expiresAt = Date.now() + SOURCE_REMOVAL_CONFIRMATION_TTL_MS
  pendingSourceRemovals.set(confirmationToken, {
    sourceId,
    digest: removalPlanDigest(plan),
    expiresAt,
  })
  return {
    ...plan,
    confirmationToken,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export async function removeSource(
  sourceId: string,
  input: { confirmationToken: string },
): Promise<{ removed: true }> {
  const source = readPluginSource(sourceId)
  if (!source) {
    throw new AppError({
      code: 'plugin_source_not_found',
      status: 404,
      message: 'Plugin source not found.',
      details: { sourceId },
    })
  }

  pruneSourceRemovalConfirmations()
  const pending = pendingSourceRemovals.get(input.confirmationToken)
  pendingSourceRemovals.delete(input.confirmationToken)
  if (!pending || pending.sourceId !== sourceId) {
    throw new AppError({
      code: 'plugin_uninstall_confirmation_required',
      status: 409,
      message: 'Inspect the plugin uninstall plan and confirm it before removing this source.',
      details: { sourceId },
    })
  }
  if (activeSourceRemovals.has(sourceId)) {
    throw new AppError({
      code: 'plugin_uninstall_in_progress',
      status: 409,
      message: 'This plugin source is already being removed.',
      details: { sourceId },
    })
  }

  activeSourceRemovals.add(sourceId)
  try {
    const currentPlan = await inspectDiscoveredSourceRemoval(source.id)
    if (pending.digest !== removalPlanDigest(currentPlan)) {
      throw new AppError({
        code: 'plugin_uninstall_plan_changed',
        status: 409,
        message: 'The plugin uninstall plan changed. Inspect and confirm the current plan before retrying.',
        details: { sourceId },
      })
    }
    if (currentPlan.blocked) {
      throw new AppError({
        code: 'plugin_uninstall_blocked',
        status: 409,
        message: 'The plugin source cannot be removed until its uninstall blockers are resolved.',
        details: { plan: currentPlan },
      })
    }
    const removedIdentities = currentPlan.plugins.map(plugin => plugin.identity)
    await removeDiscoveredSource(source.id)
    deletePluginSource(source.id)
    pluginLifecycle.publish({
      type: 'source-removed',
      sourceId: source.id,
      pluginIdentities: removedIdentities,
      chatSessionId: null,
    })
    return { removed: true }
  }
  finally {
    activeSourceRemovals.delete(sourceId)
  }
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
  input: { enabled: boolean, reason?: string | null, grantedPermissions?: string[] },
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

  const grantedPermissions = input.grantedPermissions === undefined
    ? undefined
    : [...new Set(input.grantedPermissions)].sort()
  const declaredPermissionIds = new Set([
    ...descriptor.declaredPermissions.map(permission => permission.localId),
    ...descriptor.declaredCapabilities.flatMap(capability => capability.permissions),
  ])
  const invalidPermissions = (grantedPermissions ?? []).filter(permission => !declaredPermissionIds.has(permission))
  if (invalidPermissions.length > 0) {
    throw new AppError({
      code: 'plugin_permission_not_declared',
      status: 400,
      message: 'One or more granted permissions are not declared by this plugin.',
      details: { invalidPermissions },
    })
  }
  const requiredPermissionIds = new Set([
    ...descriptor.declaredPermissions
      .filter(permission => permission.required)
      .map(permission => permission.localId),
    ...descriptor.declaredCapabilities.flatMap(capability => capability.permissions),
  ])
  const effectiveGrantedPermissions = grantedPermissions ?? descriptor.source.grantedPermissions ?? []
  const missingRequiredPermissions = descriptor.source.kind === 'externalLocal' && input.enabled
    ? [...requiredPermissionIds].filter(permission => !effectiveGrantedPermissions.includes(permission)).sort()
    : []
  if (missingRequiredPermissions.length > 0) {
    throw new AppError({
      code: 'plugin_permission_grant_required',
      status: 400,
      message: 'Required plugin permissions must be reviewed and granted before activation.',
      details: { missingRequiredPermissions },
    })
  }

  const updated = input.enabled
    ? await enablePlugin(descriptor.identity, grantedPermissions)
    : await disablePlugin(descriptor.identity, input.reason ?? undefined)
  const source = (await listSources()).find(entry => entry.plugins.some(plugin => plugin.identity === descriptor.identity))
  pluginLifecycle.publish({
    type: 'activation-changed',
    sourceId: source?.id ?? null,
    pluginIdentities: [descriptor.identity],
    chatSessionId: null,
  })
  if (input.enabled && source?.plugins.every(plugin => plugin.identity === descriptor.identity
    ? updated.activation.enabled && updated.source.trusted
    : plugin.activation.enabled && plugin.source.trusted)) {
    pluginLifecycle.publish({
      type: 'review-completed',
      sourceId: source.id,
      pluginIdentities: source.plugins.map(plugin => plugin.identity),
      chatSessionId: null,
    })
  }
  return toPluginDescriptorView(updated)
}

export async function listPendingReviews(chatSessionId: string): Promise<PendingPluginReviewView[]> {
  const reviews = pluginLifecycle.listPendingReviews(chatSessionId)
  const result: PendingPluginReviewView[] = []
  for (const review of reviews) {
    const source = readPluginSource(review.sourceId)
    if (!source) { continue }
    result.push({
      sourceId: review.sourceId,
      createdAt: review.createdAt,
      source: await toPluginSourceRegistryEntryView(source),
    })
  }
  return result
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
