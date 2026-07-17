import type { DownloadOwner } from '@cradle/download-center'
import type { Disposable } from '@cradle/plugin-sdk'

import { AppError } from '../../errors/app-error'

export type ManagedResourceState
  = | 'not-installed'
    | 'installing'
    | 'installed'
    | 'update-available'
    | 'error'
    | 'unavailable'

export type ManagedResourceInstallationSource = 'built-in' | 'managed' | 'external' | null
export type ManagedResourceActionName = 'install' | 'update' | 'uninstall'

export interface ManagedResourceKey {
  namespace: string
  resourceType: string
  resourceId: string
}

export interface ManagedResourceAction {
  available: boolean
  reasonCode: string | null
}

export interface ManagedResourceActions {
  install: ManagedResourceAction
  update: ManagedResourceAction
  uninstall: ManagedResourceAction
}

export interface ManagedResourceDeclaration {
  key: ManagedResourceKey
  displayName: string
  description: string | null
  kind: string
  required: boolean
}

export interface ManagedResourceProjection {
  state: ManagedResourceState
  installationSource: ManagedResourceInstallationSource
  installedVersion: string | null
  availableVersion: string | null
  installedSizeBytes: number | null
  downloadSizeBytes: number | null
  actions: ManagedResourceActions
}

export interface ManagedResourceDescriptor extends ManagedResourceDeclaration, ManagedResourceProjection {}

export interface ManagedResourceAdapter {
  readonly namespace: string
  declarations: () => readonly ManagedResourceDeclaration[]
  project: (key: ManagedResourceKey) => Promise<ManagedResourceProjection>
  execute: (key: ManagedResourceKey, action: ManagedResourceActionName) => Promise<ManagedResourceProjection>
}

const PROJECTION_FAILED_ACTIONS: ManagedResourceActions = {
  install: { available: false, reasonCode: 'managed_resource_projection_failed' },
  update: { available: false, reasonCode: 'managed_resource_projection_failed' },
  uninstall: { available: false, reasonCode: 'managed_resource_projection_failed' },
}

function resourceKey(key: ManagedResourceKey): string {
  return JSON.stringify([key.namespace, key.resourceType, key.resourceId])
}

function compareDescriptors(left: ManagedResourceDescriptor, right: ManagedResourceDescriptor): number {
  const leftKey = `${left.kind}\0${left.displayName}\0${resourceKey(left.key)}`
  const rightKey = `${right.kind}\0${right.displayName}\0${resourceKey(right.key)}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function projectionFailure(): ManagedResourceProjection {
  return {
    state: 'error',
    installationSource: null,
    installedVersion: null,
    availableVersion: null,
    installedSizeBytes: null,
    downloadSizeBytes: null,
    actions: PROJECTION_FAILED_ACTIONS,
  }
}

export function toManagedResourceDownloadOwner(declaration: ManagedResourceDeclaration): DownloadOwner {
  return {
    ...declaration.key,
    displayName: declaration.displayName,
  }
}

export class ManagedResourceService {
  private readonly adapterByNamespace = new Map<string, ManagedResourceAdapter>()
  private readonly declarationByKey = new Map<string, ManagedResourceDeclaration>()

  constructor(adapters: readonly ManagedResourceAdapter[]) {
    for (const adapter of adapters) {
      this.registerAdapter(adapter)
    }
  }

  registerAdapter(adapter: ManagedResourceAdapter): Disposable {
    if (this.adapterByNamespace.has(adapter.namespace)) {
      throw new Error(`Managed resource namespace is already registered: ${adapter.namespace}`)
    }

    const adapterKeys = new Set<string>()
    const declarations = adapter.declarations().map((declaration) => {
      if (declaration.key.namespace !== adapter.namespace) {
        throw new Error(`Managed resource declaration namespace does not match adapter: ${declaration.key.namespace}`)
      }
      const key = resourceKey(declaration.key)
      if (this.declarationByKey.has(key) || adapterKeys.has(key)) {
        throw new Error(`Managed resource is already declared: ${key}`)
      }
      adapterKeys.add(key)
      return {
        storageKey: key,
        declaration: {
          ...declaration,
          key: { ...declaration.key },
        },
      }
    })

    this.adapterByNamespace.set(adapter.namespace, adapter)
    for (const entry of declarations) {
      this.declarationByKey.set(entry.storageKey, entry.declaration)
    }

    let disposed = false
    return {
      dispose: () => {
        if (disposed) { return }
        disposed = true
        if (this.adapterByNamespace.get(adapter.namespace) !== adapter) { return }
        this.adapterByNamespace.delete(adapter.namespace)
        for (const entry of declarations) {
          this.declarationByKey.delete(entry.storageKey)
        }
      },
    }
  }

  async list(): Promise<ManagedResourceDescriptor[]> {
    const descriptors = await Promise.all(Array.from(this.declarationByKey.values(), declaration => this.describe(declaration)))
    return descriptors.sort(compareDescriptors)
  }

  async get(key: ManagedResourceKey): Promise<ManagedResourceDescriptor> {
    return await this.describe(this.requireDeclaration(key))
  }

  async listNamespace(namespace: string): Promise<ManagedResourceDescriptor[]> {
    const declarations = Array.from(this.declarationByKey.values())
      .filter(declaration => declaration.key.namespace === namespace)
    const descriptors = await Promise.all(declarations.map(declaration => this.describe(declaration)))
    return descriptors.sort(compareDescriptors)
  }

  async execute(key: ManagedResourceKey, action: ManagedResourceActionName): Promise<ManagedResourceDescriptor> {
    const declaration = this.requireDeclaration(key)
    const adapter = this.requireAdapter(key.namespace)
    const current = await this.readProjection(adapter, declaration.key)
    const capability = current.actions[action]
    if (!capability.available) {
      throw new AppError({
        code: capability.reasonCode ?? 'managed_resource_action_unavailable',
        status: 409,
        message: `The ${action} action is not available for this managed resource.`,
        details: { action, key: declaration.key },
      })
    }
    const projection = await adapter.execute(declaration.key, action)
    return { ...declaration, ...projection }
  }

  private async describe(declaration: ManagedResourceDeclaration): Promise<ManagedResourceDescriptor> {
    const adapter = this.requireAdapter(declaration.key.namespace)
    const projection = await this.readProjection(adapter, declaration.key)
    return { ...declaration, ...projection }
  }

  private async readProjection(
    adapter: ManagedResourceAdapter,
    key: ManagedResourceKey,
  ): Promise<ManagedResourceProjection> {
    try {
      return await adapter.project(key)
    }
    catch {
      return projectionFailure()
    }
  }

  private requireDeclaration(key: ManagedResourceKey): ManagedResourceDeclaration {
    const declaration = this.declarationByKey.get(resourceKey(key))
    if (!declaration) {
      throw new AppError({
        code: 'managed_resource_not_found',
        status: 404,
        message: 'Managed resource was not found.',
      })
    }
    return declaration
  }

  private requireAdapter(namespace: string): ManagedResourceAdapter {
    const adapter = this.adapterByNamespace.get(namespace)
    if (!adapter) {
      throw new AppError({
        code: 'managed_resource_owner_unavailable',
        status: 503,
        message: 'Managed resource owner is unavailable.',
      })
    }
    return adapter
  }
}
