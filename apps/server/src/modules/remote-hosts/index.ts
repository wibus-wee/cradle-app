import type { Elysia } from 'elysia'
import { Elysia as ElysiaApp, t } from 'elysia'

import { createUnauthorizedError, verifyWebSocketRequestToken } from '../../http/auth'
import { RemoteHostsModel } from './model'
import * as RemoteHosts from './service'
import type { UpstreamBridgeSocket } from './upstream-websocket'
import {
  RemoteUpstreamWebSocketBridge,
} from './upstream-websocket'

export const remoteHosts = new ElysiaApp({
  prefix: '/remote-hosts',
  detail: { tags: ['remote-hosts'] },
})
  .get('', () => RemoteHosts.listRemoteHosts(), {
    detail: {
      'summary': 'List remote Cradle Server hosts',
      'x-cradle-cli': {
        command: ['remote-host', 'list'],
      },
    },
    response: { 200: t.Array(RemoteHostsModel.host) },
  })
  .post('', ({ body }) => RemoteHosts.createRemoteHost({
    id: body.id,
    displayName: body.displayName,
    enabled: body.enabled,
    connectionConfig: body.connectionConfig,
    capabilities: body.capabilities,
  }), {
    detail: {
      'summary': 'Create a remote Cradle Server host',
      'x-cradle-cli': {
        command: ['remote-host', 'create'],
      },
    },
    body: RemoteHostsModel.createHostBody,
    response: { 200: RemoteHostsModel.host },
  })
  .patch('/:hostId', ({ params, body }) => RemoteHosts.updateRemoteHost(params.hostId, {
    displayName: body.displayName,
    enabled: body.enabled,
    connectionConfig: body.connectionConfig,
    capabilities: body.capabilities,
  }), {
    detail: {
      'summary': 'Update a remote Cradle Server host',
      'x-cradle-cli': {
        command: ['remote-host', 'update'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    body: RemoteHostsModel.updateHostBody,
    response: { 200: RemoteHostsModel.host },
  })
  .delete('/:hostId', async ({ params }) => {
    await RemoteHosts.deleteRemoteHost(params.hostId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete a remote Cradle Server host',
      'x-cradle-cli': {
        command: ['remote-host', 'delete'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.ok },
  })
  .post('/:hostId/cradle-server/connect', ({ params }) => RemoteHosts.connectRemoteHostCradleServer(params.hostId), {
    detail: {
      'summary': 'Connect to a remote Cradle Server',
      'x-cradle-cli': {
        command: ['remote-host', 'cradle-server', 'connect'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.cradleServerConnection },
  })
  .post('/:hostId/cradle-server/disconnect', async ({ params }) => {
    await RemoteHosts.disconnectRemoteHostCradleServer(params.hostId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Disconnect from a remote Cradle Server',
      'x-cradle-cli': {
        command: ['remote-host', 'cradle-server', 'disconnect'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.ok },
  })
  .get('/:hostId/cradle-server/health', ({ params }) => RemoteHosts.readRemoteHostCradleServerHealth(params.hostId), {
    detail: {
      'summary': 'Read remote Cradle Server health',
      'x-cradle-cli': {
        command: ['remote-host', 'cradle-server', 'health'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.cradleServerHealth },
  })
  .post('/:hostId/cradle-server/test', ({ params }) => RemoteHosts.testRemoteHostCradleServer(params.hostId), {
    detail: {
      summary: 'Test remote Cradle Server connectivity and health',
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.cradleServerHealth },
  })
  .post('/:hostId/relay/claim', ({ params, body }) => RemoteHosts.claimRemoteHostRelay(params.hostId, body.pairingString), {
    detail: {
      'summary': 'Claim a relay pairing for a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'relay', 'claim'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    body: RemoteHostsModel.relayClaimBody,
    response: { 200: RemoteHostsModel.cradleServerConnection },
  })
  .all('/:hostId/upstream/*', async ({ params, request }) => {
    const upstreamPath = `/${params['*'] ?? ''}`
    const requestUrl = new URL(request.url)
    const pathWithQuery = `${upstreamPath}${requestUrl.search}`
    return await RemoteHosts.proxyRemoteHostUpstreamRequest(params.hostId, request, pathWithQuery)
  }, {
    detail: {
      summary: 'Transparent upstream proxy to the connected remote Cradle Server',
    },
    params: t.Object({
      'hostId': t.String({ minLength: 1 }),
      '*': t.Optional(t.String()),
    }, { additionalProperties: false }),
  })

/** Register Upgrade handling directly on the Node-adapted root app. */
export function registerRemoteHostWebSocketRoutes(app: Elysia): Elysia {
  const upstreamWebSocketBridges = new Map<string, RemoteUpstreamWebSocketBridge>()
  app.ws('/remote-hosts/:hostId/upstream/*', {
    detail: {
      summary: 'Transparent WebSocket upstream to the connected remote Cradle Server',
    },
    body: t.Any(),
    parse: (_ws, message) => message,
    beforeHandle({ request }) {
      const audience = new URL(request.url).pathname
      if (!verifyWebSocketRequestToken(request, { audience })) {
        throw createUnauthorizedError()
      }
    },
    open(ws) {
      const requestUrl = new URL(ws.data.request.url)
      const upstreamPath = `/${ws.data.params['*'] ?? ''}`
      const pathWithQuery = `${upstreamPath}${requestUrl.search}`
      const bridge = new RemoteUpstreamWebSocketBridge(
        ws as UpstreamBridgeSocket,
        async () => (await RemoteHosts.ensureRemoteHostConnected(ws.data.params.hostId)).baseUrl,
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
    params: t.Object({
      'hostId': t.String({ minLength: 1 }),
      '*': t.Optional(t.String()),
    }, { additionalProperties: false }),
  })
  app.onStop(() => {
    for (const bridge of upstreamWebSocketBridges.values()) {
      bridge.close(1001, 'Server stopping')
    }
    upstreamWebSocketBridges.clear()
  })
  return app
}
