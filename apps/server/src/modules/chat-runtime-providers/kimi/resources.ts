import type { ManagedChildProcess } from '../../../infra/managed-process'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import type { RuntimeProcessResources } from '../../provider-runtime/process-resources'
import {
  emptyRuntimeProcessResources,
  readManagedProcessPid,
  readProcessResourceUsage,
} from '../../provider-runtime/process-resources'
import type { KimiWebHostResource } from './web-host'

export interface KimiServerResources extends RuntimeProcessResources {
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

function emptyKimiServerResources(): KimiServerResources {
  return {
    ...emptyRuntimeProcessResources(),
    url: null,
  }
}

function readKimiHostResources(resource: KimiWebHostResource): KimiServerResources {
  const proc: ManagedChildProcess = resource.process
  const pid = readManagedProcessPid(proc)
  if (!pid) {
    return emptyKimiServerResources()
  }
  const usage = readProcessResourceUsage(pid)
  return {
    running: true,
    pid,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
    url: resource.url ?? null,
  }
}

export function getKimiServerResources(): KimiServerResources {
  return providerRuntimeHostManager.forEachResource('kimi', (resource) => {
    if (isKimiWebHostResource(resource)) {
      return readKimiHostResources(resource)
    }
    return undefined
  }) ?? emptyKimiServerResources()
}
