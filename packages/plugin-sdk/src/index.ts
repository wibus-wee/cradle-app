/** Disposable subscription — call dispose() to unregister */
export interface Disposable {
  dispose: () => void
}

/** Plugin manifest as parsed from package.json */
export interface PluginManifest {
  /** npm package name */
  name: string
  /** Package version */
  version: string
  /** Absolute path to the plugin package directory */
  packageDir: string
  /** The cradle-specific metadata from package.json */
  cradle: CradlePluginMeta
}

export interface CradlePluginMeta {
  /** Plugin contract version. */
  apiVersion: '1'
  displayName?: string
  description?: string
  /** Plugin package-relative icon file used by host UI surfaces. */
  icon?: string
  /** Which deployments this plugin supports */
  deployments?: Array<'desktop' | 'web'>
  /** Entry point for server-side plugin */
  server?: string
  /** Entry point for web/renderer plugin */
  web?: string
  /** Entry point for desktop/Electron main plugin */
  desktop?: string
  /** Structured static contributions declared before runtime activation. */
  contributes: CradlePluginContributions
}

export interface CradlePluginContributions {
  /** Static capabilities this plugin may register or expose at runtime. */
  capabilities: CradlePluginCapabilityContribution[]
  /** Host permissions this plugin requests. */
  permissions: CradlePluginPermissionContribution[]
}

export interface CradlePluginCapabilityContribution {
  /** Plugin-local capability id, scoped by the host with the package identity. */
  id: string
  /** Capability category, such as mcp-server, skill, web-panel, or desktop.webviewListener. */
  type: string
  /** Runtime layer that owns this capability when known. */
  layer?: PluginLayer
  label?: string
  description?: string
  permissions: string[]
  metadata?: Record<string, unknown>
}

export interface CradlePluginPermissionContribution {
  /** Plugin-local permission id, scoped by the host with the package identity. */
  id: string
  label?: string
  description?: string
  required?: boolean
}

/** Plugin-scoped logger */
export interface Logger {
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
  debug: (msg: string, ...args: unknown[]) => void
}

export type PluginSourceKind = 'workspaceDev' | 'bundledResource' | 'externalLocal'

export type PluginLayer = 'server' | 'web' | 'desktop'

export type PluginLayerStatus
  = | 'discovered'
    | 'invalid'
    | 'skipped'
    | 'disabled'
    | 'activating'
    | 'active'
    | 'failed'
    | 'partial'

export interface PluginSourceDescriptor {
  kind: PluginSourceKind
  packageDir: string
  trusted: boolean
  reason?: string
  provenance?: PluginSourceProvenance
  grantedPermissions?: string[]
}

export interface PluginSourceProvenance {
  kind: 'marketplace-install'
  installedAt: string
  mode: 'alreadyAvailable' | 'downloaded'
  source: string
  repository: string
  path: string
  packageName: string
  version: string
  channel: string
  ref: string
  originalUrl?: string
  grantedPermissions?: string[]
}

export interface PluginLayerState {
  layer: PluginLayer
  status: PluginLayerStatus
  entry?: string
  error?: string
  activatedAt?: string
}

export interface PluginActivationState {
  enabled: boolean
  source: 'default' | 'user'
  reason?: string
  updatedAt?: number
}

export type PluginCapabilityStatus = 'registered' | 'failed' | 'unsupported'

export interface PluginCapabilityRecord {
  id: string
  owner: string
  type: string
  layer: PluginLayer
  status: PluginCapabilityStatus
  label?: string
  metadata?: Record<string, unknown>
}

export interface PluginDeclaredCapabilityRecord {
  id: string
  owner: string
  localId: string
  type: string
  layer?: PluginLayer
  label?: string
  description?: string
  permissions: string[]
  metadata?: Record<string, unknown>
}

export interface PluginDeclaredPermissionRecord {
  id: string
  owner: string
  localId: string
  label?: string
  description?: string
  required?: boolean
}

export interface PluginDescriptor {
  identity: string
  routeSegment: string
  name: string
  version: string
  displayName: string
  description?: string
  icon?: string
  deployments?: Array<'desktop' | 'web'>
  source: PluginSourceDescriptor
  activation: PluginActivationState
  layers: Record<PluginLayer, PluginLayerState>
  capabilities: PluginCapabilityRecord[]
  declaredCapabilities: PluginDeclaredCapabilityRecord[]
  declaredPermissions: PluginDeclaredPermissionRecord[]
  warnings: string[]
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
  serverEntry?: string
  webEntry?: string
  desktopEntry?: string
}

export function derivePluginRouteSegment(identity: string): string {
  if (identity.startsWith('@cradle/plugin-')) {
    return identity.slice('@cradle/plugin-'.length)
  }
  if (identity.startsWith('@cradle/')) {
    return identity.slice('@cradle/'.length)
  }
  if (identity.startsWith('@')) {
    const [scope, name] = identity.slice(1).split('/')
    if (scope && name) {
      return `scope-${scope}--${name}`.replace(/[^\w.~-]/g, '-')
    }
  }
  return identity.replace(/[^\w.~-]/g, '-')
}

export function derivePluginCapabilityId(owner: string, localId: string): string {
  return `${owner}:${localId}`
}

function toPluginLocalId(owner: string, id: string): string {
  return id.startsWith(`${owner}:`) ? id.slice(owner.length + 1) : id
}

export interface ProjectedCradlePluginContributions {
  declaredCapabilities: PluginDeclaredCapabilityRecord[]
  declaredPermissions: PluginDeclaredPermissionRecord[]
}

export function projectCradlePluginContributions(
  owner: string,
  meta: CradlePluginMeta,
): ProjectedCradlePluginContributions {
  const declaredCapabilities = meta.contributes.capabilities.map((capability) => {
    const localId = toPluginLocalId(owner, capability.id)
    return {
      id: derivePluginCapabilityId(owner, localId),
      owner,
      localId,
      type: capability.type,
      layer: capability.layer,
      label: capability.label,
      description: capability.description,
      permissions: capability.permissions,
      metadata: capability.metadata,
    }
  })

  const declaredPermissions = meta.contributes.permissions.map((permission) => {
    const localId = toPluginLocalId(owner, permission.id)
    return {
      id: derivePluginCapabilityId(owner, localId),
      owner,
      localId,
      label: permission.label,
      description: permission.description,
      required: permission.required,
    }
  })

  return { declaredCapabilities, declaredPermissions }
}
