import { createChildLogger } from '../../logging/logger'
import { OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import type { RuntimeKind } from '../provider-contracts/types'

export interface ProviderRuntimeHostKey {
  runtimeKind: RuntimeKind
  providerTargetId: string
  scopeId: string
}

export interface ProviderRuntimeHostSnapshot {
  hostId: string
  runtimeKind: RuntimeKind
  providerTargetId: string
  scopeId: string
  refCount: number
  pinnedCount: number
  hasResource: boolean
  expiresAt: number
  updatedAt: number
}

export class ProviderRuntimeLease<Resource = undefined> {
  private released = false

  constructor(
    private readonly manager: ProviderRuntimeHostManager,
    readonly hostId: string,
    readonly pinned: boolean,
    readonly resource: Resource,
  ) {}

  refresh(ttlMs?: number): void {
    if (this.released) {
      return
    }
    this.manager.refreshLease(this.hostId, ttlMs)
  }

  release(): void {
    if (this.released) {
      return
    }
    this.released = true
    this.manager.releaseLease(this.hostId, this.pinned)
  }
}

export type ProviderRuntimeResourceFactory<Resource> = () => Resource | Promise<Resource>
export type ProviderRuntimeResourceDisposer<Resource> = (resource: Resource) => void | Promise<void>

interface RuntimeHostEntry extends ProviderRuntimeHostSnapshot {
  resource?: unknown
  resourcePromise?: Promise<unknown>
  disposeResource?: ProviderRuntimeResourceDisposer<unknown>
  resourceFingerprint?: string
}

const DEFAULT_HOST_TTL_MS = 30 * 60 * 1000
const DEFAULT_HOST_REAPER_INTERVAL_MS = 60 * 1000
const logger = createChildLogger({ module: 'provider-runtime.host-manager' })

export class ProviderRuntimeHostManager {
  private readonly hosts = new Map<string, RuntimeHostEntry>()
  private readonly pendingDisposals = new Set<Promise<void>>()
  private reaperTimer: ReturnType<typeof setInterval> | null = null

  acquireLease(input: ProviderRuntimeHostKey & {
    ttlMs?: number
    pinned?: boolean
  }): ProviderRuntimeLease {
    const retained = this.retainHost(input)
    return new ProviderRuntimeLease(this, retained.hostId, retained.pinned, undefined)
  }

  async acquireResource<Resource>(input: ProviderRuntimeHostKey & {
    ttlMs?: number
    pinned?: boolean
    resourceFingerprint?: string
    createResource: ProviderRuntimeResourceFactory<Resource>
    disposeResource: ProviderRuntimeResourceDisposer<Resource>
  }): Promise<ProviderRuntimeLease<Resource>> {
    const retained = this.retainHost(input)
    const entry = retained.entry

    entry.disposeResource = input.disposeResource as ProviderRuntimeResourceDisposer<unknown>
    if (
      input.resourceFingerprint !== undefined
      && entry.resourceFingerprint !== undefined
      && entry.resourceFingerprint !== input.resourceFingerprint
    ) {
      if (entry.refCount > 1) {
        this.releaseLease(retained.hostId, retained.pinned)
        throw new Error(`Provider runtime host resource is already active with incompatible options: ${retained.hostId}`)
      }
      await this.disposeHostResource(entry)
    }
    if (!entry.resourcePromise) {
      entry.resourceFingerprint = input.resourceFingerprint
      entry.resourcePromise = Promise.resolve()
        .then(input.createResource)
        .then((resource) => {
          entry.resource = resource
          entry.hasResource = true
          return resource
        })
        .catch((error) => {
          entry.resourcePromise = undefined
          entry.resource = undefined
          entry.hasResource = false
          entry.resourceFingerprint = undefined
          throw error
        })
    }

    try {
      const resource = await entry.resourcePromise as Resource
      if (this.hosts.get(retained.hostId) !== entry) {
        this.releaseLease(retained.hostId, retained.pinned)
        throw new Error(`Provider runtime host was released before resource was ready: ${retained.hostId}`)
      }
      return new ProviderRuntimeLease(this, retained.hostId, retained.pinned, resource)
    }
    catch (error) {
      this.releaseLease(retained.hostId, retained.pinned)
      throw error
    }
  }

  refreshLease(hostId: string, ttlMs = DEFAULT_HOST_TTL_MS): void {
    const entry = this.hosts.get(hostId)
    if (!entry) {
      return
    }
    const now = Date.now()
    entry.expiresAt = now + ttlMs
    entry.updatedAt = now
  }

  releaseLease(hostId: string, pinned: boolean): void {
    const entry = this.hosts.get(hostId)
    if (!entry) {
      return
    }
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (pinned) {
      entry.pinnedCount = Math.max(0, entry.pinnedCount - 1)
    }
    entry.updatedAt = Date.now()
    if (entry.refCount === 0) {
      this.removeHost(hostId, entry)
    }
  }

  invalidateResource(hostId: string): Promise<void> {
    const entry = this.hosts.get(hostId)
    if (!entry) {
      return Promise.resolve()
    }
    return this.disposeHostResource(entry)
  }

  startReaper(intervalMs = DEFAULT_HOST_REAPER_INTERVAL_MS): void {
    if (this.reaperTimer) {
      return
    }
    this.reapIdleHosts()
    this.reaperTimer = setInterval(() => {
      this.reapIdleHosts()
    }, intervalMs)
    if (typeof this.reaperTimer === 'object' && 'unref' in this.reaperTimer) {
      this.reaperTimer.unref()
    }
  }

  stopReaper(): void {
    if (!this.reaperTimer) {
      return
    }
    clearInterval(this.reaperTimer)
    this.reaperTimer = null
  }

  reapIdleHosts(now = Date.now()): void {
    for (const [hostId, entry] of this.hosts) {
      if (entry.expiresAt <= now && entry.refCount <= entry.pinnedCount) {
        this.removeHost(hostId, entry)
      }
    }
  }

  listHosts(): ProviderRuntimeHostSnapshot[] {
    this.reapIdleHosts()
    return Array.from(this.hosts.values(), entry => ({
      hostId: entry.hostId,
      runtimeKind: entry.runtimeKind,
      providerTargetId: entry.providerTargetId,
      scopeId: entry.scopeId,
      refCount: entry.refCount,
      pinnedCount: entry.pinnedCount,
      hasResource: entry.hasResource,
      expiresAt: entry.expiresAt,
      updatedAt: entry.updatedAt,
    }))
  }

  hasHost(hostId: string): boolean {
    this.reapIdleHosts()
    return this.hosts.has(hostId)
  }

  async clear(): Promise<void> {
    const disposals: Promise<void>[] = []
    for (const [hostId, entry] of this.hosts) {
      disposals.push(this.removeHost(hostId, entry))
    }
    this.hosts.clear()
    await Promise.allSettled([...disposals, ...this.pendingDisposals])
  }

  async shutdown(): Promise<void> {
    this.stopReaper()
    await this.clear()
  }

  private readHostId(input: ProviderRuntimeHostKey): string {
    return `${input.runtimeKind}:${input.providerTargetId}:${input.scopeId}`
  }

  private retainHost(input: ProviderRuntimeHostKey & {
    ttlMs?: number
    pinned?: boolean
  }): { hostId: string, pinned: boolean, entry: RuntimeHostEntry } {
    this.reapIdleHosts()
    const hostId = this.readHostId(input)
    const now = Date.now()
    const entry = this.hosts.get(hostId) ?? {
      hostId,
      runtimeKind: input.runtimeKind,
      providerTargetId: input.providerTargetId,
      scopeId: input.scopeId,
      refCount: 0,
      pinnedCount: 0,
      hasResource: false,
      expiresAt: now,
      updatedAt: now,
    }

    const pinned = input.pinned ?? false
    entry.refCount += 1
    if (pinned) {
      entry.pinnedCount += 1
    }
    entry.expiresAt = now + (input.ttlMs ?? DEFAULT_HOST_TTL_MS)
    entry.updatedAt = now
    this.hosts.set(hostId, entry)
    return { hostId, pinned, entry }
  }

  private removeHost(hostId: string, entry: RuntimeHostEntry): Promise<void> {
    this.hosts.delete(hostId)
    return this.disposeHostResource(entry)
  }

  private disposeHostResource(entry: RuntimeHostEntry): Promise<void> {
    const resource = entry.resource
    const resourcePromise = entry.resourcePromise
    const disposeResource = entry.disposeResource
    entry.resource = undefined
    entry.resourcePromise = undefined
    entry.hasResource = false
    entry.resourceFingerprint = undefined
    if (resource !== undefined && disposeResource) {
      return this.trackDisposal(this.disposeResourceWithLogging(entry, disposeResource, resource))
    }
    if (resourcePromise && disposeResource) {
      return this.trackDisposal(resourcePromise
        .then(resource => this.disposeResourceWithLogging(entry, disposeResource, resource))
        .catch(error => this.recordDisposalFailure(entry, error)))
    }
    return Promise.resolve()
  }

  private trackDisposal(disposal: Promise<void>): Promise<void> {
    this.pendingDisposals.add(disposal)
    disposal.finally(() => {
      this.pendingDisposals.delete(disposal)
    })
    return disposal
  }

  private async disposeResourceWithLogging(
    entry: RuntimeHostEntry,
    disposeResource: ProviderRuntimeResourceDisposer<unknown>,
    resource: unknown,
  ): Promise<void> {
    try {
      await disposeResource(resource)
    }
    catch (error) {
      this.recordDisposalFailure(entry, error)
    }
  }

  private recordDisposalFailure(entry: RuntimeHostEntry, error: unknown): void {
    logger.error('provider runtime resource disposal failed', {
      error,
      hostId: entry.hostId,
      runtimeKind: entry.runtimeKind,
      providerTargetId: entry.providerTargetId,
      scopeId: entry.scopeId,
    })
    Observability.record({
      source: 'server',
      code: OBSERVABILITY_CODES.providerRuntimeDisposalFailed,
      severity: 'error',
      category: 'provider',
      message: 'Provider runtime resource disposal failed.',
      attrs: {
        hostId: entry.hostId,
        runtimeKind: entry.runtimeKind,
        providerTargetId: entry.providerTargetId,
        scopeId: entry.scopeId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export const providerRuntimeHostManager = new ProviderRuntimeHostManager()
