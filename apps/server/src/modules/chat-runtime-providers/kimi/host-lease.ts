import type { RuntimeKind } from '../../provider-contracts/types'
import type { ProviderProcessHostLease } from '../kit/process-host'
import { acquireProviderProcessHostResource } from '../kit/process-host'
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
