import { Elysia, t } from 'elysia'

import { RelayServersModel } from './model'
import * as RelayServers from './service'

export const relayServers = new Elysia({
  prefix: '/relay-servers',
  detail: { tags: ['relay-servers'] },
})
  .get('', () => RelayServers.listRelayServers(), {
    detail: {
      'summary': 'List relay servers',
      'x-cradle-cli': {
        command: ['relay-server', 'list'],
      },
    },
    response: { 200: t.Array(RelayServersModel.relayServer) },
  })
  .post('', ({ body }) => RelayServers.createRelayServer({
    id: body.id,
    displayName: body.displayName,
    relayUrl: body.relayUrl,
    enabled: body.enabled,
    isDefault: body.isDefault,
  }), {
    detail: {
      'summary': 'Create a relay server',
      'x-cradle-cli': {
        command: ['relay-server', 'create'],
      },
    },
    body: RelayServersModel.createRelayServerBody,
    response: { 200: RelayServersModel.relayServer },
  })
  .patch('/:relayServerId', ({ params, body }) => RelayServers.updateRelayServer(params.relayServerId, {
    displayName: body.displayName,
    relayUrl: body.relayUrl,
    enabled: body.enabled,
    isDefault: body.isDefault,
  }), {
    detail: {
      'summary': 'Update a relay server',
      'x-cradle-cli': {
        command: ['relay-server', 'update'],
      },
    },
    params: RelayServersModel.relayServerIdParams,
    body: RelayServersModel.updateRelayServerBody,
    response: { 200: RelayServersModel.relayServer },
  })
  .delete('/:relayServerId', async ({ params }) => {
    await RelayServers.deleteRelayServer(params.relayServerId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete a relay server',
      'x-cradle-cli': {
        command: ['relay-server', 'delete'],
      },
    },
    params: RelayServersModel.relayServerIdParams,
    response: { 200: RelayServersModel.ok },
  })
