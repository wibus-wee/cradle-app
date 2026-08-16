import { AppError } from '../../errors/app-error'
import type { MembershipCertificate, NodeSummary } from './protocol'

export class FabricDirectoryClient {
  constructor(readonly relayUrl: string) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, `${this.relayUrl.replace(/\/+$/, '')}/`), {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new AppError({
        code: response.status === 503 ? 'fabric_node_offline' : 'fabric_directory_request_failed',
        status: response.status === 503 ? 503 : 502,
        message: payload?.error ?? `Fabric directory returned HTTP ${response.status}.`,
      })
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  createFabric(request: Record<string, unknown>) {
    return this.request<{ fabric: { fabricId: string, ownerPubkey: string } }>('/v1/fabrics', jsonRequest('POST', request))
  }

  createJoinRequest(request: Record<string, unknown>) {
    return this.request<{ requestId: string, expiresAt: string }>('/v1/join-requests', jsonRequest('POST', request))
  }

  readJoinRequest(requestId: string, deliverySecret: string) {
    return this.request<{ status: 'pending' | 'approved', request: Record<string, unknown>, certificate?: MembershipCertificate }>(`/v1/join-requests/${encodeURIComponent(requestId)}?secret=${encodeURIComponent(deliverySecret)}`)
  }

  approveJoinRequest(requestId: string, certificate: MembershipCertificate, headers: Headers) {
    return this.request<NodeSummary>(`/v1/join-requests/${encodeURIComponent(requestId)}/approve`, jsonRequest('POST', { certificate }, headers))
  }

  registerController(fabricId: string, certificate: MembershipCertificate, grants: Array<{ grantId: string, fabricId: string, controllerId: string, nodeId: string, scope: string }>, headers: Headers) {
    return this.request<void>(`/v1/fabrics/${encodeURIComponent(fabricId)}/controllers`, jsonRequest('POST', { certificate, grants }, headers))
  }

  listNodes(fabricId: string, headers: Headers) {
    return this.request<NodeSummary[]>(`/v1/fabrics/${encodeURIComponent(fabricId)}/nodes`, { headers })
  }

  openLink(nodeId: string, headers: Headers) {
    return this.request<{ linkId: string, expiresAt: string, nodeCertificate: MembershipCertificate }>(`/v1/nodes/${encodeURIComponent(nodeId)}/links`, { method: 'POST', headers })
  }
}

function jsonRequest(method: string, body: unknown, headers = new Headers()): RequestInit {
  const resolved = new Headers(headers)
  resolved.set('content-type', 'application/json')
  return { method, headers: resolved, body: JSON.stringify(body) }
}
