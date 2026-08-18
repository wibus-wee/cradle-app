import type { Elysia as ElysiaType } from 'elysia'
import { Elysia, t } from 'elysia'

import { createUnauthorizedError, verifyWebSocketRequestToken } from '../../http/auth'
import { proxyUpstreamRequestWithReconnect } from '../../http/upstream'
import { FabricModel } from './model'
import * as Fabric from './service'
import type { UpstreamBridgeSocket } from './upstream-websocket'
import { FabricUpstreamWebSocketBridge } from './upstream-websocket'

export { registerFabricMembershipChangedListener } from './service'

export const fabric = new Elysia({ prefix: '/fabric', detail: { tags: ['fabric'] } })
  .get('', () => {
    const membership = Fabric.getFabricMembership()
    return membership ?? new Response('null', {
      headers: { 'content-type': 'application/json' },
    })
  }, { detail: { summary: 'Read this Cradle Server Fabric membership' }, response: { 200: FabricModel.nullableMembership } })
  .get('/managed-relay', () => Fabric.getManagedRelay(), {
    detail: { summary: 'Read the current Desktop Fabric relay endpoint' },
    response: { 200: FabricModel.managedRelay },
  })
  .post('', ({ body }) => Fabric.createFabric(body), { detail: { summary: 'Create a Cradle Fabric and enroll this Node' }, body: FabricModel.createBody, response: { 200: FabricModel.membership } })
  .post('/node-invitations', ({ body }) => Fabric.createNodeInvitation(body), { detail: { summary: 'Create a short-lived Node enrollment invitation' }, body: FabricModel.beginNodeEnrollmentBody, response: { 200: FabricModel.invitation } })
  .get('/node-invitations/pending', () => {
    const pending = Fabric.getPendingNodeEnrollment()
    return pending ?? new Response('null', {
      headers: { 'content-type': 'application/json' },
    })
  }, { detail: { summary: 'Read this Server pending Node enrollment' }, response: { 200: FabricModel.pendingEnrollment } })
  .delete('/node-invitations/pending', ({ set }) => {
    Fabric.cancelPendingNodeEnrollment()
    set.status = 204
  }, { detail: { summary: 'Cancel this Server pending Node enrollment' }, response: { 204: t.Void() } })
  .post('/node-invitations/complete', () => Fabric.completeNodeEnrollment(), { detail: { summary: 'Complete an approved Node enrollment' }, response: { 200: FabricModel.nullableMembership } })
  .post('/node-invitations/approve', ({ body }) => Fabric.approveNodeInvitation(body), { detail: { summary: 'Approve a Node enrollment invitation' }, body: FabricModel.invitation, response: { 200: FabricModel.nodeSummary } })

export interface FabricNodeLinkProvider {
  ensure: (nodeId: string) => Promise<{ localBaseUrl: string }>
}

export function createFabricNodeRoutes(nodeLinkProvider: FabricNodeLinkProvider) {
  return new Elysia({ prefix: '/nodes', detail: { tags: ['nodes'] } })
    .get('', () => Fabric.listNodes(), { detail: { summary: 'List Nodes visible in this Fabric' }, response: { 200: t.Array(FabricModel.nodeSummary) } })
    .get('/:nodeId', ({ params }) => Fabric.getNode(params.nodeId), { detail: { summary: 'Read one Node directory summary' }, params: FabricModel.nodeIdParams, response: { 200: FabricModel.nodeSummary } })
    .get('/:nodeId/grants', ({ params }) => Fabric.listNodeGrants(params.nodeId), { detail: { summary: 'List Controller grants on a Node (owner only)' }, params: FabricModel.nodeIdParams, response: { 200: t.Array(FabricModel.nodeGrant) } })
    .delete('/:nodeId/grants/:grantId', async ({ params, set }) => { await Fabric.revokeNodeGrant(params.nodeId, params.grantId); set.status = 204 }, { detail: { summary: 'Revoke a Controller grant on a Node (owner only)' }, params: FabricModel.nodeGrantParams, response: { 204: t.Void() } })
    .post('/:nodeId/connect', ({ params }) => Fabric.openNodeLink(params.nodeId), { detail: { summary: 'Open an encrypted link to a Node' }, params: FabricModel.nodeIdParams, response: { 200: FabricModel.link } })
    .all('/:nodeId/upstream/*', async ({ params, request }) => {
      const path = `/${params['*'] ?? ''}${new URL(request.url).search}`
      return await proxyUpstreamRequestWithReconnect(
        async () => (await nodeLinkProvider.ensure(params.nodeId)).localBaseUrl,
        request,
        path,
      )
    }, {
      detail: { summary: 'Transparent upstream proxy to a Fabric Node' },
      params: t.Object({ 'nodeId': t.String({ minLength: 1 }), '*': t.Optional(t.String()) }, { additionalProperties: false }),
    })
}

/**
 * WebSocket routing is registered separately because Elysia's Node adapter
 * owns upgrades at the application root. Each upgraded connection is bridged
 * to the Node's Cradle Server through the on-demand Fabric node link.
 */
export function registerFabricWebSocketRoutes(app: ElysiaType, nodeLinkProvider: FabricNodeLinkProvider): ElysiaType {
  const upstreamWebSocketBridges = new Map<string, FabricUpstreamWebSocketBridge>()
  app.ws('/nodes/:nodeId/upstream/*', {
    detail: { summary: 'Transparent WebSocket upstream to a Fabric Node' },
    body: t.Any(),
    parse: (_ws, message) => message,
    beforeHandle({ request }) {
      if (!verifyWebSocketRequestToken(request, { audience: new URL(request.url).pathname })) { throw createUnauthorizedError() }
    },
    open(ws) {
      const requestUrl = new URL(ws.data.request.url)
      const upstreamPath = `/${ws.data.params['*'] ?? ''}`
      const pathWithQuery = `${upstreamPath}${requestUrl.search}`
      const bridge = new FabricUpstreamWebSocketBridge(
        ws as UpstreamBridgeSocket,
        async () => (await nodeLinkProvider.ensure(ws.data.params.nodeId)).localBaseUrl,
        pathWithQuery,
      )
      upstreamWebSocketBridges.set(ws.id, bridge)
      void bridge.open()
    },
    message(ws, message) {
      upstreamWebSocketBridges.get(ws.id)?.send(message)
    },
    drain(ws) {
      upstreamWebSocketBridges.get(ws.id)?.drain()
    },
    close(ws, code, reason) {
      const bridge = upstreamWebSocketBridges.get(ws.id)
      upstreamWebSocketBridges.delete(ws.id)
      bridge?.close(code, reason)
    },
    params: t.Object({ 'nodeId': t.String({ minLength: 1 }), '*': t.Optional(t.String()) }, { additionalProperties: false }),
  })
  return app
}
