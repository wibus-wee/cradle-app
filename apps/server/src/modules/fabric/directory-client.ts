import { AppError } from '../../errors/app-error'
import type { FabricJoinRequest, FabricNodeGrant, MembershipCertificate, NodeSummary } from './protocol'

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
    if (response.status === 204) { return undefined as T }
    return await response.json() as T
  }

  createFabric(request: Record<string, unknown>) {
    return this.request<{ fabric: { fabricId: string, ownerPubkey: string } }>('/v1/fabrics', jsonRequest('POST', request))
  }

  createJoinRequest(request: FabricJoinRequest) {
    return this.request<{ requestId: string, expiresAt: string }>('/v1/join-requests', jsonRequest('POST', request))
  }

  readJoinRequest(requestId: string, deliverySecret: string) {
    return this.request<{
      status: 'pending' | 'approved' | 'rejected'
      request: FabricJoinRequest
      nodeCertificate?: MembershipCertificate
      controllerCertificate?: MembershipCertificate
    }>(`/v1/join-requests/${encodeURIComponent(requestId)}?secret=${encodeURIComponent(deliverySecret)}`)
  }

  listJoinRequests(fabricId: string, headers: Headers) {
    return this.request<{ requests: FabricJoinRequest[] }>(`/v1/fabrics/${encodeURIComponent(fabricId)}/join-requests`, { headers }).then(result => result.requests)
  }

  approveJoinRequest(requestId: string, nodeCertificate: MembershipCertificate, controllerCertificate: MembershipCertificate, headers: Headers) {
    return this.request<NodeSummary>(`/v1/join-requests/${encodeURIComponent(requestId)}/approve`, jsonRequest('POST', { nodeCertificate, controllerCertificate }, headers))
  }

  rejectJoinRequest(fabricId: string, requestId: string, headers: Headers) {
    return this.request<void>(`/v1/fabrics/${encodeURIComponent(fabricId)}/join-requests/${encodeURIComponent(requestId)}`, { method: 'DELETE', headers })
  }

  registerController(fabricId: string, certificate: MembershipCertificate, grants: Array<{ grantId: string, fabricId: string, controllerId: string, nodeId: string, scope: string }>, headers: Headers) {
    return this.request<void>(`/v1/fabrics/${encodeURIComponent(fabricId)}/controllers`, jsonRequest('POST', { certificate, grants }, headers))
  }

  listNodes(fabricId: string, headers: Headers) {
    return this.request<{ nodes: NodeSummary[] }>(`/v1/fabrics/${encodeURIComponent(fabricId)}/nodes`, { headers }).then(result => result.nodes)
  }

  openLink(nodeId: string, headers: Headers) {
    return this.request<{ linkId: string, expiresAt: string, nodeCertificate: MembershipCertificate }>(`/v1/nodes/${encodeURIComponent(nodeId)}/links`, { method: 'POST', headers })
  }

  listNodeGrants(nodeId: string, headers: Headers) {
    return this.request<{ grants: FabricNodeGrant[] }>(`/v1/nodes/${encodeURIComponent(nodeId)}/grants`, { headers }).then(result => result.grants)
  }

  revokeNodeGrant(nodeId: string, grantId: string, headers: Headers) {
    return this.request<void>(`/v1/nodes/${encodeURIComponent(nodeId)}/grants/${encodeURIComponent(grantId)}`, { method: 'DELETE', headers })
  }

  removeNode(nodeId: string, headers: Headers) {
    return this.request<void>(`/v1/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE', headers })
  }
}

function jsonRequest(method: string, body: unknown, headers = new Headers()): RequestInit {
  const resolved = new Headers(headers)
  resolved.set('content-type', 'application/json')
  return { method, headers: resolved, body: JSON.stringify(body) }
}
