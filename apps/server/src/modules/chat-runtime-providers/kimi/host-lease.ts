import type { RuntimeKind } from '../../provider-contracts/types'
import type { ProviderProcessHostLease } from '../kit/process-host'
import {
  acquireProviderProcessHostResource,
  invalidateProviderProcessHostResource,
  listProviderProcessHosts,
} from '../kit/process-host'
import { createKimiWebHostFingerprint } from './host-fingerprint'
import type { KimiWebHostOptions, KimiWebHostResource } from './web-host'
import { createKimiWebHostResource } from './web-host'

export type KimiWebHostLease = ProviderProcessHostLease<KimiWebHostResource>

export function kimiProviderTargetHostScopeId(providerTargetId: string): string {
  return `provider-target:${providerTargetId}`
}

/** N provider targets map to N Kimi hosts, while every session of one target shares its host. */
export async function acquireKimiWebHostLease(input: {
  runtimeKind: RuntimeKind
  providerTargetId: string
  options: KimiWebHostOptions
  pinned?: boolean
}): Promise<KimiWebHostLease> {
  return await acquireProviderProcessHostResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: kimiProviderTargetHostScopeId(input.providerTargetId),
    pinned: input.pinned ?? false,
    resourceFingerprint: createKimiWebHostFingerprint(input.options),
    createResource: () => createKimiWebHostResource(input.options),
    disposeResource: resource => resource.close(),
  })
}

export async function stopKimiWebHostForSessionStorage(providerTargetId: string): Promise<'not_running' | 'stopped' | 'busy'> {
  const host = listProviderProcessHosts().find(item => (
    item.runtimeKind === 'kimi'
    && item.providerTargetId === providerTargetId
    && item.scopeId === kimiProviderTargetHostScopeId(providerTargetId)
    && item.hasResource
  ))
  if (!host) {
    return 'not_running'
  }
  // The storage caller owns one resume lease. Any additional reference belongs
  // to another live session sharing this provider-target host.
  if (host.refCount > 1) {
    return 'busy'
  }
  await invalidateProviderProcessHostResource(host.hostId)
  return 'stopped'
}
