import type { Elysia as ElysiaType } from 'elysia'
import { Elysia, t } from 'elysia'

import { createUnauthorizedError, verifyWebSocketRequestToken } from '../../http/auth'
import { FabricModel } from './model'
import * as Fabric from './service'
import { getFabricNodeLinkManager } from './node-link-manager'
import { proxyUpstreamRequestWithReconnect } from '../remote-hosts/upstream'

export const fabric = new Elysia({ prefix: '/fabric', detail: { tags: ['fabric'] } })
  .get('', () => Fabric.getFabricMembership(), { detail: { summary: 'Read this Cradle Server Fabric membership' }, response: { 200: FabricModel.nullableMembership } })
  .post('', ({ body }) => Fabric.createFabric(body), { detail: { summary: 'Create a Cradle Fabric and enroll this Node' }, body: FabricModel.createBody, response: { 200: FabricModel.membership } })
  .post('/node-invitations', ({ body }) => Fabric.createNodeInvitation(body), { detail: { summary: 'Create a short-lived Node enrollment invitation' }, body: FabricModel.beginNodeEnrollmentBody, response: { 200: FabricModel.invitation } })
  .post('/node-invitations/approve', ({ body }) => Fabric.approveNodeInvitation(body), { detail: { summary: 'Approve a Node enrollment invitation' }, body: FabricModel.invitation, response: { 200: FabricModel.nodeSummary } })

export const nodes = new Elysia({ prefix: '/nodes', detail: { tags: ['nodes'] } })
  .get('', () => Fabric.listNodes(), { detail: { summary: 'List Nodes visible in this Fabric' }, response: { 200: t.Array(FabricModel.nodeSummary) } })
  .post('/:nodeId/connect', ({ params }) => Fabric.openNodeLink(params.nodeId), { detail: { summary: 'Open an encrypted link to a Node' }, params: FabricModel.nodeIdParams, response: { 200: FabricModel.link } })
  .all('/:nodeId/upstream/*', async ({ params, request }) => {
    const path = `/${params['*'] ?? ''}${new URL(request.url).search}`
    return await proxyUpstreamRequestWithReconnect(
      async () => (await getFabricNodeLinkManager().ensure(params.nodeId)).localBaseUrl,
      request, path,
    )
  }, {
    detail: { summary: 'Transparent upstream proxy to a Fabric Node' },
    params: t.Object({ nodeId: t.String({ minLength: 1 }), '*': t.Optional(t.String()) }, { additionalProperties: false }),
  })

/** WebSocket routing is registered separately because Elysia's Node adapter
 * owns upgrades at the application root. It deliberately fails closed until
 * the v3 Node link manager has supplied an authenticated local endpoint. */
export function registerFabricWebSocketRoutes(app: ElysiaType): ElysiaType {
  app.ws('/nodes/:nodeId/upstream/*', {
    detail: { summary: 'Transparent WebSocket upstream to a Fabric Node' }, body: t.Any(), parse: (_ws, message) => message,
    beforeHandle({ request }) {
      if (!verifyWebSocketRequestToken(request, { audience: new URL(request.url).pathname })) throw createUnauthorizedError()
    },
    open(ws) { ws.close(1013, 'Fabric link is not ready') },
    params: t.Object({ nodeId: t.String({ minLength: 1 }), '*': t.Optional(t.String()) }, { additionalProperties: false }),
  })
  return app
}
