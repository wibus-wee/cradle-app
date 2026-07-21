import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import type { RuntimeProcessResources } from '../../../provider-runtime/process-resources'
import {
  emptyRuntimeProcessResources,
  readProcessResourceUsage,
} from '../../../provider-runtime/process-resources'
import type { CodexAppServerHostResource } from '../types'

function isCodexAppServerHostResource(resource: unknown): resource is CodexAppServerHostResource {
  return (
    typeof resource === 'object'
    && resource !== null
    && 'client' in resource
    && typeof (resource as CodexAppServerHostResource).client === 'object'
  )
}

function readCodexHostResources(resource: CodexAppServerHostResource): RuntimeProcessResources {
  const pid = resource.client.pid
  if (!pid) {
    return emptyRuntimeProcessResources()
  }
  const usage = readProcessResourceUsage(pid)
  return {
    running: true,
    pid,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
  }
}

export function getCodexAppServerResources(): RuntimeProcessResources {
  return providerRuntimeHostManager.forEachResource('codex', (resource) => {
    if (isCodexAppServerHostResource(resource)) {
      return readCodexHostResources(resource)
    }
    return undefined
  }) ?? emptyRuntimeProcessResources()
}
