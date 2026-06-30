import { Elysia, t } from 'elysia'

import { RemoteHostsModel } from './model'
import * as RemoteHosts from './service'

export const remoteHosts = new Elysia({
  prefix: '/remote-hosts',
  detail: { tags: ['remote-hosts'] },
})
  .get('', () => RemoteHosts.listRemoteHosts(), {
    detail: {
      'summary': 'List remote hosts',
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
      'summary': 'Create a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'create'],
      },
    },
    body: RemoteHostsModel.createHostBody,
    response: { 200: RemoteHostsModel.host },
  })
  .post('/relay/enrollments/:enrollmentId/host-session', ({ params, body }) => RemoteHosts.createRemoteHostRelayHostSession(params.enrollmentId, {
    enrollmentSecret: body.enrollmentSecret,
    ttlMs: body.ttlMs,
  }), {
    detail: {
      summary: 'Create a short-lived relay host session for an enrolled agentd',
    },
    params: RemoteHostsModel.relayEnrollmentIdParams,
    body: RemoteHostsModel.relayHostSessionBody,
    response: { 200: RemoteHostsModel.relayHostSessionResponse },
  })
  .patch('/:hostId', ({ params, body }) => RemoteHosts.updateRemoteHost(params.hostId, {
    displayName: body.displayName,
    enabled: body.enabled,
    connectionConfig: body.connectionConfig,
    capabilities: body.capabilities,
  }), {
    detail: {
      'summary': 'Update a remote host',
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
      'summary': 'Delete a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'delete'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.ok },
  })
  .post('/:hostId/agentd/connect', ({ params }) => RemoteHosts.connectRemoteHostAgentd(params.hostId), {
    detail: {
      'summary': 'Connect to a remote host agentd daemon',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'connect'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.connection },
  })
  .post('/:hostId/agentd/disconnect', async ({ params }) => {
    await RemoteHosts.disconnectRemoteHostAgentd(params.hostId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Disconnect from a remote host agentd daemon',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'disconnect'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.ok },
  })
  .get('/:hostId/agentd/health', ({ params }) => RemoteHosts.readRemoteHostAgentdHealth(params.hostId), {
    detail: {
      'summary': 'Read remote host agentd daemon health',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'health'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.health },
  })
  .post('/:hostId/cradle-server/connect', ({ params }) => RemoteHosts.connectRemoteHostCradleServer(params.hostId), {
    detail: {
      'summary': 'Connect to a remote Cradle Server through SSH',
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
      'summary': 'Disconnect from a remote Cradle Server tunnel',
      'x-cradle-cli': {
        command: ['remote-host', 'cradle-server', 'disconnect'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.ok },
  })
  .get('/:hostId/cradle-server/health', ({ params }) => RemoteHosts.readRemoteHostCradleServerHealth(params.hostId), {
    detail: {
      'summary': 'Read remote Cradle Server health through the SSH tunnel',
      'x-cradle-cli': {
        command: ['remote-host', 'cradle-server', 'health'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.cradleServerHealth },
  })
  .post('/:hostId/cradle-server/test', ({ params }) => RemoteHosts.testRemoteHostCradleServer(params.hostId), {
    detail: {
      'summary': 'Test remote Cradle Server SSH connectivity and health',
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.cradleServerHealth },
  })
  .get('/:hostId/agentd/runtimes', ({ params }) => RemoteHosts.listRemoteRuntimes(params.hostId), {
    detail: {
      'summary': 'List runtimes exposed by a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'runtime', 'list'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.runtimeList },
  })
  .get('/:hostId/agentd/workspaces', ({ params, query }) => RemoteHosts.listRemoteWorkspaces(params.hostId, {
    root: query.root ?? null,
  }), {
    detail: {
      'summary': 'List legacy workspace suggestions from a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'workspace', 'list'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    query: RemoteHostsModel.workspaceQuery,
    response: { 200: RemoteHostsModel.workspaceList },
  })
  .get('/:hostId/agentd/fs/directory', ({ params, query }) => RemoteHosts.listRemoteDirectory(params.hostId, {
    path: query.path ?? null,
  }), {
    detail: {
      'summary': 'List a directory on a connected remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'fs', 'directory', 'list'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    query: RemoteHostsModel.fsPathQuery,
    response: { 200: RemoteHostsModel.fsDirectoryList },
  })
  .get('/:hostId/agentd/fs/stat', ({ params, query }) => RemoteHosts.statRemotePath(params.hostId, {
    path: query.path,
  }), {
    detail: {
      'summary': 'Stat a path on a connected remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'fs', 'stat'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    query: RemoteHostsModel.requiredFsPathQuery,
    response: { 200: RemoteHostsModel.fsStat },
  })
  .get('/:hostId/agentd/git/repository', ({ params, query }) => RemoteHosts.probeRemoteRepository(params.hostId, {
    path: query.path,
  }), {
    detail: {
      'summary': 'Probe whether a remote path belongs to a git repository',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'git', 'repository', 'probe'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    query: RemoteHostsModel.requiredFsPathQuery,
    response: { 200: RemoteHostsModel.gitRepositoryProbe },
  })
  .get('/:hostId/agentd/agents', ({ params }) => RemoteHosts.listRemoteAgents(params.hostId), {
    detail: {
      'summary': 'List live agents on a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'agent', 'list'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.agentList },
  })
  .post('/:hostId/agentd/agents', ({ params, body }) => RemoteHosts.startRemoteAgent(params.hostId, {
    runtimeKind: body.runtimeKind,
    workspacePath: body.workspacePath,
    chatSessionId: body.chatSessionId ?? null,
    providerSessionId: body.providerSessionId ?? null,
    modelId: body.modelId ?? null,
  }), {
    detail: {
      'summary': 'Start a mock remote agent on a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'agentd', 'agent', 'start'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    body: RemoteHostsModel.startAgentBody,
    response: { 200: RemoteHostsModel.startAgentResponse },
  })
  .post('/:hostId/relay/pairing-token', ({ params, body }) => RemoteHosts.createRemoteHostRelayPairingToken(params.hostId, {
    relayUrl: body.relayUrl,
    relayServerId: body.relayServerId,
    ttlMs: body.ttlMs,
  }), {
    detail: {
      'summary': 'Create relay pairing tokens for a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'relay', 'pairing-token'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    body: RemoteHostsModel.relayPairingTokenBody,
    response: { 200: RemoteHostsModel.relayPairingTokenResponse },
  })
  .post('/:hostId/relay/claim', ({ params, body }) => RemoteHosts.claimRemoteHostRelayPairing(params.hostId, {
    relayUrl: body.relayUrl,
    relayServerId: body.relayServerId,
    pairingCode: body.pairingCode,
    ttlMs: body.ttlMs,
  }), {
    detail: {
      'summary': 'Claim a relay pairing code for a remote host',
      'x-cradle-cli': {
        command: ['remote-host', 'relay', 'claim'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    body: RemoteHostsModel.relayClaimBody,
    response: { 200: RemoteHostsModel.relayClaimResponse },
  })
