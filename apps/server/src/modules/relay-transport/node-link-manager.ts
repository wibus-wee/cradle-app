import { fabricAuthHeaders } from '../fabric/protocol'
import { openNodeLink, requireFabricMembership, requireFabricMembershipSecretRefs } from '../fabric/service'
import { readSecret } from '../secrets/service'
import type { RelayControllerTransportHandle } from './controller-transport'
import { startRelayControllerTransport } from './controller-transport'

/**
 * Demand-driven controller links. A Node never gets a pre-opened tunnel just
 * because it appears in the directory; callers obtain one only when proxying
 * an upstream request and the handle is released after the existing idle
 * policy or a relay close.
 */
export class FabricNodeLinkManager {
  private readonly handles = new Map<string, RelayControllerTransportHandle>()
  private readonly opening = new Map<string, Promise<RelayControllerTransportHandle>>()

  async ensure(nodeId: string): Promise<RelayControllerTransportHandle> {
    const existing = this.handles.get(nodeId)
    if (existing) { return existing }
    const inFlight = this.opening.get(nodeId)
    if (inFlight) { return await inFlight }
    const opening = this.open(nodeId).finally(() => this.opening.delete(nodeId))
    this.opening.set(nodeId, opening)
    return await opening
  }

  async close(nodeId: string): Promise<void> {
    const handle = this.handles.get(nodeId)
    this.handles.delete(nodeId)
    await handle?.close()
  }

  async shutdown(): Promise<void> { await Promise.all(Array.from(this.handles.keys(), nodeId => this.close(nodeId))) }

  private async open(nodeId: string): Promise<RelayControllerTransportHandle> {
    const membership = requireFabricMembership()
    const secretRefs = requireFabricMembershipSecretRefs()
    const link = await openNodeLink(nodeId)
    const headers = fabricAuthHeaders(membership.controllerCertificate, readSecret(secretRefs.identityKeySecretId), 'GET', `/v1/ws/controllers/${link.linkId}`)
    const handle = await startRelayControllerTransport({
relayUrl: membership.relayUrl,
      controllerPrivateKeyBase64: readSecret(secretRefs.encryptionKeySecretId),
      controllerPublicKeyBase64: membership.controllerCertificate.encryptionPubkey,
      nodePublicKeyBase64: link.nodeCertificate.encryptionPubkey,
      fabric: { fabricId: membership.fabricId, nodeId, linkId: link.linkId, headers },
    })
    this.handles.set(nodeId, handle)
    handle.onExit(() => { if (this.handles.get(nodeId) === handle) { this.handles.delete(nodeId) } })
    return handle
  }
}

let manager: FabricNodeLinkManager | null = null
export function getFabricNodeLinkManager(): FabricNodeLinkManager { manager ??= new FabricNodeLinkManager(); return manager }
