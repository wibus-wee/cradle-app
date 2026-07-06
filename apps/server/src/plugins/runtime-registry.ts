import type { PluginActivationState, PluginCapabilityRecord, PluginDescriptor, PluginLayer, PluginLayerState, PluginLayerStatus, PluginManifest, PluginSourceDescriptor, PluginSourceKind } from '@cradle/plugin-sdk'
import {
  derivePluginCapabilityId,
  derivePluginRouteSegment,
  projectCradlePluginContributions,
} from '@cradle/plugin-sdk'
import { evaluatePluginRuntimeCapabilityPolicy } from '@cradle/plugin-sdk/permissions'

const layerNames: PluginLayer[] = ['server', 'web', 'desktop']

const descriptors = new Map<string, PluginDescriptor>()
const routeOwners = new Map<string, string>()

function markDescriptorInvalid(descriptor: PluginDescriptor, error: string): void {
  for (const layer of layerNames) {
    descriptor.layers[layer] = {
      ...descriptor.layers[layer],
      status: 'invalid',
      error,
    }
  }
  descriptor.warnings.push(error)
}

function createUniqueCapabilityId(descriptor: PluginDescriptor, owner: string, localId: string): string {
  const baseId = derivePluginCapabilityId(owner, localId)
  if (!descriptor.capabilities.some(capability => capability.id === baseId)) {
    return baseId
  }

  let index = 2
  let nextId = `${baseId}#${index}`
  while (descriptor.capabilities.some(capability => capability.id === nextId)) {
    index += 1
    nextId = `${baseId}#${index}`
  }
  return nextId
}

export function classifyPluginSource(
  packageDir: string,
  pluginsDir: string,
  sourceKind?: PluginSourceKind,
): PluginSourceDescriptor {
  const isDev = process.env.NODE_ENV !== 'production'
  const configuredPluginsDir = process.env.CRADLE_PLUGINS_DIR?.trim()
  const isConfiguredExternal = sourceKind === 'externalLocal'
    || (!!configuredPluginsDir && packageDir.startsWith(configuredPluginsDir))
  const kind: PluginSourceKind = sourceKind
    ?? (isConfiguredExternal
      ? 'externalLocal'
      : isDev
        ? 'workspaceDev'
        : 'bundledResource')

  return {
    kind,
    packageDir,
    trusted: kind !== 'externalLocal',
    reason: kind === 'externalLocal'
      ? 'External local plugins require an operator trust grant before activation.'
      : `Discovered under ${pluginsDir}.`,
  }
}

export function createPluginDescriptor(
  manifest: PluginManifest,
  source: PluginSourceDescriptor,
): PluginDescriptor {
  const identity = manifest.name
  const routeSegment = derivePluginRouteSegment(identity)

  const contributions = projectCradlePluginContributions(identity, manifest.cradle)

  const layers = Object.fromEntries(layerNames.map((layer) => {
    const entry = manifest.cradle[layer]
    return [layer, {
      layer,
      status: entry ? 'discovered' : 'skipped',
      entry: entry ?? undefined,
    } satisfies PluginLayerState]
  })) as Record<PluginLayer, PluginLayerState>

  return {
    identity,
    routeSegment,
    name: identity,
    version: manifest.version,
    displayName: manifest.cradle.displayName ?? identity,
    description: manifest.cradle.description,
    icon: manifest.cradle.icon,
    deployments: manifest.cradle.deployments,
    source,
    activation: { enabled: true, source: 'default' },
    layers,
    capabilities: [],
    declaredCapabilities: contributions.declaredCapabilities,
    declaredPermissions: contributions.declaredPermissions,
    warnings: [],
    hasWeb: !!manifest.cradle.web,
    hasServer: !!manifest.cradle.server,
    hasDesktop: !!manifest.cradle.desktop,
    serverEntry: manifest.cradle.server ?? undefined,
    webEntry: manifest.cradle.web ?? undefined,
    desktopEntry: manifest.cradle.desktop ?? undefined,
  }
}

export function createInvalidPluginDescriptor(
  identity: string,
  version: string,
  source: PluginSourceDescriptor,
  error: string,
): PluginDescriptor {
  const routeSegment = derivePluginRouteSegment(identity)
  const layers = Object.fromEntries(layerNames.map(layer => [layer, {
    layer,
    status: 'invalid',
    error,
  } satisfies PluginLayerState])) as Record<PluginLayer, PluginLayerState>

  return {
    identity,
    routeSegment,
    name: identity,
    version,
    displayName: identity,
    source,
    activation: { enabled: true, source: 'default' },
    layers,
    capabilities: [],
    declaredCapabilities: [],
    declaredPermissions: [],
    warnings: [error],
    hasWeb: false,
    hasServer: false,
    hasDesktop: false,
  }
}

export function resetPluginRuntimeRegistry(): void {
  descriptors.clear()
  routeOwners.clear()
}

export function registerPluginDescriptor(descriptor: PluginDescriptor): void {
  const existingIdentity = descriptors.get(descriptor.identity)
  if (existingIdentity) {
    const error = `Duplicate plugin identity ${descriptor.identity} from ${descriptor.source.packageDir}; first source was ${existingIdentity.source.packageDir}.`
    markDescriptorInvalid(existingIdentity, error)
    markDescriptorInvalid(descriptor, error)
    descriptors.set(`${descriptor.identity}#duplicate:${descriptor.source.packageDir}`, descriptor)
    return
  }

  const routeOwner = routeOwners.get(descriptor.routeSegment)
  if (routeOwner && routeOwner !== descriptor.identity) {
    markDescriptorInvalid(descriptor, `Route segment ${descriptor.routeSegment} collides with ${routeOwner}.`)
  }

  descriptors.set(descriptor.identity, descriptor)
  if (!routeOwner) {
    routeOwners.set(descriptor.routeSegment, descriptor.identity)
  }
}

function rebuildRouteOwners(): void {
  routeOwners.clear()
  for (const descriptor of descriptors.values()) {
    if (!routeOwners.has(descriptor.routeSegment)) {
      routeOwners.set(descriptor.routeSegment, descriptor.identity)
    }
  }
}

export function unregisterPluginDescriptor(owner: string): void {
  descriptors.delete(owner)
  for (const key of [...descriptors.keys()]) {
    if (key.startsWith(`${owner}#duplicate:`)) {
      descriptors.delete(key)
    }
  }
  rebuildRouteOwners()
}

export function setPluginActivationState(owner: string, activation: PluginActivationState): void {
  const descriptor = descriptors.get(owner)
  if (!descriptor) { return }
  descriptor.activation = activation
}

export function setPluginSourceDescriptor(owner: string, source: PluginSourceDescriptor): void {
  const descriptor = descriptors.get(owner)
  if (!descriptor) { return }
  descriptor.source = source
}

export function setPluginLayerState(
  owner: string,
  layer: PluginLayer,
  status: PluginLayerStatus,
  error?: string,
): void {
  const descriptor = descriptors.get(owner)
  if (!descriptor) { return }
  descriptor.layers[layer] = {
    ...descriptor.layers[layer],
    status,
    error,
    activatedAt: status === 'active' ? new Date().toISOString() : descriptor.layers[layer].activatedAt,
  }
}

export function registerPluginCapability(
  owner: string,
  type: string,
  layer: PluginLayer,
  localId: string,
  label?: string,
  metadata?: Record<string, unknown>,
  candidateDeclaredLocalIds?: string[],
): PluginCapabilityRecord {
  const descriptor = descriptors.get(owner)
  if (descriptor) {
    const policy = evaluatePluginRuntimeCapabilityPolicy(descriptor, {
      type,
      layer,
      localId,
      candidateDeclaredLocalIds,
    })
    if (!policy.allowed) {
      throw new Error(policy.reason ?? `Runtime capability ${type}:${localId} is not allowed.`)
    }
    if (policy.warning && !descriptor.warnings.includes(policy.warning)) {
      descriptor.warnings.push(policy.warning)
    }
  }
  const record: PluginCapabilityRecord = {
    id: descriptor
      ? createUniqueCapabilityId(descriptor, owner, `${type}.${localId}`)
      : derivePluginCapabilityId(owner, `${type}.${localId}`),
    owner,
    type,
    layer,
    status: 'registered',
    label,
    metadata,
  }
  descriptor?.capabilities.push(record)
  return record
}

export function unregisterPluginCapability(owner: string, capabilityId: string): void {
  const descriptor = descriptors.get(owner)
  if (!descriptor) { return }
  descriptor.capabilities = descriptor.capabilities.filter(capability => capability.id !== capabilityId)
}

export function getPluginDescriptor(owner: string): PluginDescriptor | undefined {
  return descriptors.get(owner)
}

export function getPluginDescriptorByRouteSegment(routeSegment: string): PluginDescriptor | undefined {
  const owner = routeOwners.get(routeSegment)
  return owner ? descriptors.get(owner) : undefined
}

export function listPluginDescriptors(): PluginDescriptor[] {
  return [...descriptors.values()]
}
