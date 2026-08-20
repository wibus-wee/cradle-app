import type { RuntimeProcessResource } from '../../../../infra/process-resources'
import {
  emptyRuntimeProcessResources,
  readProcessResourceUsage,
} from '../../../../infra/process-resources'
import type { ProviderRuntimeHostSnapshot } from '../../../provider-runtime/host-manager'
import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import type { ServerDiagnosticsResponse } from '../app-server-protocol/v2/ServerDiagnosticsResponse'
import type { CodexAppServerHostResource } from '../types'

export interface CodexAppServerNativeDiagnostics {
  hostId: string
  providerTargetId: string
  scopeId: string
  diagnostics: ServerDiagnosticsResponse | null
  error: string | null
}

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

export async function getCodexAppServerNativeDiagnostics(): Promise<CodexAppServerNativeDiagnostics[]> {
  const reads = providerRuntimeHostManager.collectResources('codex', (resource, host) => {
    if (!isCodexAppServerHostResource(resource)) {
      return undefined
    }
    return readCodexAppServerNativeDiagnostics(resource, host)
  })
  return await Promise.all(reads)
}

async function readCodexAppServerNativeDiagnostics(
  resource: CodexAppServerHostResource,
  host: ProviderRuntimeHostSnapshot,
): Promise<CodexAppServerNativeDiagnostics> {
  try {
    const diagnostics = await resource.client.request('server/diagnostics', {}) as ServerDiagnosticsResponse
    return {
      hostId: host.hostId,
      providerTargetId: host.providerTargetId,
      scopeId: host.scopeId,
      diagnostics,
      error: null,
    }
  }
  catch (error) {
    return {
      hostId: host.hostId,
      providerTargetId: host.providerTargetId,
      scopeId: host.scopeId,
      diagnostics: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
