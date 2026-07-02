import { Elysia, t } from 'elysia'

import { RemoteHostsModel } from './model'
import * as RemoteHosts from './service'

export const remoteHosts = new Elysia({
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
      'summary': 'Test remote Cradle Server connectivity and health',
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.cradleServerHealth },
  })
  .get('/:hostId/cradle-server/workspaces', async ({ params }) => ({
    workspaces: await RemoteHosts.listRemoteCradleWorkspaces(params.hostId),
  }), {
    detail: {
      'summary': 'List workspaces from a remote Cradle Server',
      'x-cradle-cli': {
        command: ['remote-host', 'cradle-server', 'workspace', 'list'],
      },
    },
    params: RemoteHostsModel.hostIdParams,
    response: { 200: RemoteHostsModel.remoteWorkspaceList },
  })
  .get('/:hostId/cradle-server/workspaces/:remoteWorkspaceId/files', async ({ params }) => ({
    files: await RemoteHosts.listRemoteCradleWorkspaceFiles(params.hostId, params.remoteWorkspaceId),
  }), {
    detail: {
      summary: 'List root files from a remote Cradle Server workspace',
    },
    params: RemoteHostsModel.remoteWorkspaceIdParams,
    response: { 200: RemoteHostsModel.workspaceFileList },
  })
  .get('/:hostId/cradle-server/workspaces/:remoteWorkspaceId/files/children', async ({ params, query }) => ({
    files: await RemoteHosts.listRemoteCradleWorkspaceFileChildren(
      params.hostId,
      params.remoteWorkspaceId,
      query.path ?? '',
    ),
  }), {
    detail: {
      summary: 'List child files from a remote Cradle Server workspace',
    },
    params: RemoteHostsModel.remoteWorkspaceIdParams,
    query: RemoteHostsModel.fileChildrenQuery,
    response: { 200: RemoteHostsModel.workspaceFileList },
  })
  .get('/:hostId/cradle-server/workspaces/:remoteWorkspaceId/files/content', ({ params, query }) => {
    return RemoteHosts.readRemoteCradleWorkspaceFileContent(params.hostId, params.remoteWorkspaceId, query.path)
  }, {
    detail: {
      summary: 'Read file content from a remote Cradle Server workspace',
    },
    params: RemoteHostsModel.remoteWorkspaceIdParams,
    query: RemoteHostsModel.fileContentQuery,
    response: { 200: RemoteHostsModel.readFileResponse },
  })
  .get('/:hostId/cradle-server/workspaces/:remoteWorkspaceId/files/info', ({ params, query }) => {
    return RemoteHosts.readRemoteCradleWorkspaceFileInfo(params.hostId, params.remoteWorkspaceId, query.path)
  }, {
    detail: {
      summary: 'Read file metadata from a remote Cradle Server workspace',
    },
    params: RemoteHostsModel.remoteWorkspaceIdParams,
    query: RemoteHostsModel.fileInfoQuery,
    response: { 200: RemoteHostsModel.fileInfoResponse },
  })
