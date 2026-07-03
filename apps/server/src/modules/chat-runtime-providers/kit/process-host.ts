import type { RuntimeLiveResourceLease } from '../../chat-runtime/runtime-provider-types'
import type {
  ProviderRuntimeHostKey,
  ProviderRuntimeHostSnapshot,
  ProviderRuntimeLease,
  ProviderRuntimeResourceDisposer,
  ProviderRuntimeResourceFactory,
} from '../../provider-runtime/host-manager'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'

export type ProviderProcessHostKey = ProviderRuntimeHostKey
export type ProviderProcessHostSnapshot = ProviderRuntimeHostSnapshot
export type ProviderProcessHostLease<Resource = undefined> = ProviderRuntimeLease<Resource>

export interface AcquireProviderProcessHostResourceInput<Resource> extends ProviderProcessHostKey {
  ttlMs?: number
  pinned?: boolean
  resourceFingerprint?: string
  createResource: ProviderRuntimeResourceFactory<Resource>
  disposeResource: ProviderRuntimeResourceDisposer<Resource>
}

export async function acquireProviderProcessHostResource<Resource>(
  input: AcquireProviderProcessHostResourceInput<Resource>,
): Promise<ProviderProcessHostLease<Resource>> {
  return await providerRuntimeHostManager.acquireResource(input)
}

export function invalidateProviderProcessHostResource(hostId: string): void {
  providerRuntimeHostManager.invalidateResource(hostId)
}

export function listProviderProcessHosts(): ProviderProcessHostSnapshot[] {
  return providerRuntimeHostManager.listHosts()
}

export function createDetachedProcessHostLease<Resource>(
  resource: Resource,
): RuntimeLiveResourceLease<Resource> {
  return {
    resource,
    refresh() {},
    release() {},
  }
}

export function registerProcessHostLeaseCleanup<Resource>(
  lease: Pick<ProviderProcessHostLease<Resource>, 'release'>,
  cleanup: () => void,
): void {
  const releaseHost = lease.release.bind(lease)
  let released = false
  lease.release = () => {
    if (released) {
      return
    }
    released = true
    cleanup()
    releaseHost()
  }
}
