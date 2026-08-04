import type { ProviderRuntimeHostSnapshot } from '../../../provider-runtime/host-manager'
import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import type { RuntimeProcessResource } from '../../../provider-runtime/process-resources'
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

function readCodexHostResources(
  resource: CodexAppServerHostResource,
  host: ProviderRuntimeHostSnapshot,
): RuntimeProcessResource {
  const pid = resource.client.pid
  if (!pid) {
    return {
      ...emptyRuntimeProcessResources(),
      hostId: host.hostId,
      providerTargetId: host.providerTargetId,
      scopeId: host.scopeId,
    }
  }
  const usage = readProcessResourceUsage(pid)
  return {
    running: true,
    pid,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
    hostId: host.hostId,
    providerTargetId: host.providerTargetId,
    scopeId: host.scopeId,
  }
}

export function getCodexAppServerResources(): RuntimeProcessResource[] {
  return providerRuntimeHostManager.collectResources('codex', (resource, host) => {
    if (isCodexAppServerHostResource(resource)) {
      return readCodexHostResources(resource, host)
    }
    return undefined
  })
}
