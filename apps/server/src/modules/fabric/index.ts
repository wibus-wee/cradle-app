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
  .patch('/relay-url', ({ body }) => Fabric.updateFabricRelayUrl(body), {
    detail: { summary: 'Update this Server local Fabric Relay URL' },
    body: FabricModel.updateRelayUrlBody,
    response: { 200: FabricModel.membership },
  })
  .get('/managed-relay', () => Fabric.getManagedRelay(), {
    detail: { summary: 'Read the current Desktop Fabric relay endpoint' },
    response: { 200: FabricModel.managedRelay },
  })
  .get('/managed-relay/resources', () => Fabric.getManagedRelayResources(), {
    detail: { summary: 'Read the Desktop-managed Relay process resource usage' },
    response: { 200: FabricModel.managedRelayResources },
  })
  .post('', ({ body }) => Fabric.createFabric(body), { detail: { summary: 'Create a Cradle Fabric and enroll this Node' }, body: FabricModel.createBody, response: { 200: FabricModel.membership } })
  .delete('', ({ set }) => {
    Fabric.leaveFabric()
    set.status = 204
  }, { detail: { summary: 'Leave this Server Fabric membership (non-owner only)' }, response: { 204: t.Void() } })
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
  .get('/node-invitations/requests', () => Fabric.listPendingNodeRequests(), {
    detail: { summary: 'List pending Node enrollment requests (owner only)' },
    response: { 200: t.Array(FabricModel.pendingNodeRequest) },
  })
  .post('/node-invitations/requests/:requestId/approve', ({ params }) => Fabric.approvePendingNodeRequest(params.requestId), {
    detail: { summary: 'Approve a pending Node enrollment request (owner only)' },
    params: FabricModel.requestIdParams,
    response: { 200: FabricModel.nodeSummary },
  })
  .delete('/node-invitations/requests/:requestId', async ({ params, set }) => {
    await Fabric.rejectPendingNodeRequest(params.requestId)
    set.status = 204
  }, {
    detail: { summary: 'Reject a pending Node enrollment request (owner only)' },
    params: FabricModel.requestIdParams,
    response: { 204: t.Void() },
  })
  .get('/controller-invitations/requests', () => Fabric.listPendingControllerRequests(), {
    detail: { summary: 'List pending Controller enrollment requests (owner only)' },
    response: { 200: t.Array(FabricModel.pendingControllerRequest) },
  })
  .post('/controller-invitations/requests/:requestId/approve', ({ params, body }) => Fabric.approvePendingControllerRequest(params.requestId, body), {
    detail: { summary: 'Approve a Controller with explicit per-Node grants (owner only)' },
    params: FabricModel.requestIdParams,
    body: FabricModel.approveControllerRequest,
    response: { 200: FabricModel.controllerApproval },
  })
  .delete('/controller-invitations/requests/:requestId', async ({ params, set }) => {
    await Fabric.rejectPendingNodeRequest(params.requestId)
    set.status = 204
  }, {
    detail: { summary: 'Reject a pending Controller enrollment request (owner only)' },
    params: FabricModel.requestIdParams,
    response: { 204: t.Void() },
  })
  .delete('/controllers/:controllerId', async ({ params, set }) => {
    await Fabric.revokeFabricController(params.controllerId)
    set.status = 204
  }, {
    detail: { summary: 'Permanently revoke a Controller and all grants (owner only)' },
    params: FabricModel.controllerIdParams,
    response: { 204: t.Void() },
  })

export interface FabricNodeLinkProvider {
  ensure: (nodeId: string) => Promise<{ localBaseUrl: string }>
}

export function createFabricNodeRoutes(nodeLinkProvider: FabricNodeLinkProvider) {
  return new Elysia({ prefix: '/nodes', detail: { tags: ['nodes'] } })
    .get('', () => Fabric.listNodes(), { detail: { summary: 'List Nodes visible in this Fabric' }, response: { 200: t.Array(FabricModel.nodeSummary) } })
    .get('/:nodeId', ({ params }) => Fabric.getNode(params.nodeId), { detail: { summary: 'Read one Node directory summary' }, params: FabricModel.nodeIdParams, response: { 200: FabricModel.nodeSummary } })
    .delete('/:nodeId', async ({ params, set }) => { await Fabric.removeNode(params.nodeId); set.status = 204 }, { detail: { summary: 'Permanently remove a remote device from this Fabric (owner only)' }, params: FabricModel.nodeIdParams, response: { 204: t.Void() } })
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
