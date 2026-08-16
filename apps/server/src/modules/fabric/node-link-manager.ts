import type { LocalTunnelHandle } from '../../runtime/local-tunnel'
import { startRelayControllerTransport, type RelayControllerTransportHandle } from '../relay-transport/controller-transport'
import { fabricAuthHeaders } from './protocol'
import { openNodeLink, requireFabricMembership } from './service'
import { readSecret } from '../secrets/service'

/** Demand-driven controller links. A Node never gets a pre-opened tunnel just
 * because it appears in the directory; callers obtain one only when proxying
 * an upstream request and the handle is released after the existing idle
 * policy or a relay close. */
export class FabricNodeLinkManager {
  private readonly handles = new Map<string, RelayControllerTransportHandle>()
  private readonly opening = new Map<string, Promise<RelayControllerTransportHandle>>()

  async ensure(nodeId: string): Promise<RelayControllerTransportHandle> {
    const existing = this.handles.get(nodeId)
    if (existing) return existing
    const inFlight = this.opening.get(nodeId)
    if (inFlight) return await inFlight
    const opening = this.open(nodeId).finally(() => this.opening.delete(nodeId))
    this.opening.set(nodeId, opening)
    return await opening
  }

  async close(nodeId: string): Promise<void> {
    const handle = this.handles.get(nodeId)
    this.handles.delete(nodeId)
    await handle?.close()
  }

  async shutdown(): Promise<void> { await Promise.all([...this.handles.keys()].map(nodeId => this.close(nodeId))) }

  private async open(nodeId: string): Promise<RelayControllerTransportHandle> {
    const membership = requireFabricMembership()
    const link = await openNodeLink(nodeId)
    const headers = fabricAuthHeaders(membership.controllerCertificate, readSecret(membership.identityKeySecretId), 'GET', `/v1/ws/controllers/${link.linkId}`)
    const handle = await startRelayControllerTransport({
      hostId: nodeId, relayUrl: membership.relayUrl, roomId: link.linkId,
      controllerPrivateKeyBase64: readSecret(membership.encryptionKeySecretId),
      controllerPublicKeyBase64: membership.controllerCertificate.encryptionPubkey,
      pinnedHostPubkey: link.nodeCertificate.encryptionPubkey,
      fabric: { fabricId: membership.fabricId, nodeId, linkId: link.linkId, headers },
    })
    this.handles.set(nodeId, handle)
    handle.onExit(() => { if (this.handles.get(nodeId) === handle) this.handles.delete(nodeId) })
    return handle
  }
}

let manager: FabricNodeLinkManager | null = null
export function getFabricNodeLinkManager(): FabricNodeLinkManager { manager ??= new FabricNodeLinkManager(); return manager }
