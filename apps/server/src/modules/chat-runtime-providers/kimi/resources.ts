import type { ManagedChildProcess } from '../../../infra/managed-process'
import type { ProviderRuntimeHostSnapshot } from '../../provider-runtime/host-manager'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import type { RuntimeProcessResource } from '../../provider-runtime/process-resources'
import {
  emptyRuntimeProcessResources,
  readManagedProcessPid,
  readProcessResourceUsage,
} from '../../provider-runtime/process-resources'
import type { KimiWebHostResource } from './web-host'

export interface KimiServerResources extends RuntimeProcessResource {
  url: string | null
}

function isKimiWebHostResource(resource: unknown): resource is KimiWebHostResource {
  return (
    typeof resource === 'object'
    && resource !== null
    && 'process' in resource
    && 'url' in resource
  )
}

function readKimiHostResources(
  resource: KimiWebHostResource,
  host: ProviderRuntimeHostSnapshot,
): KimiServerResources {
  const proc: ManagedChildProcess = resource.process
  const pid = readManagedProcessPid(proc)
  const usage = pid ? readProcessResourceUsage(pid) : null
  return {
    ...emptyRuntimeProcessResources(),
    hostId: host.hostId,
    providerTargetId: host.providerTargetId,
    scopeId: host.scopeId,
    running: pid !== null,
    pid,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
    url: resource.url ?? null,
  }
}

export function getKimiServerResources(): KimiServerResources[] {
  return providerRuntimeHostManager.collectResources('kimi', (resource, host) => {
    if (isKimiWebHostResource(resource)) {
      return readKimiHostResources(resource, host)
    }
    return undefined
  })
}
