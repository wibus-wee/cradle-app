import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { WorkspaceModel } from './model'
import * as Workspace from './service'

function trimValue(value: string): string {
  return value.trim()
}

function nullableJsonResponse<T>(value: T | null): T | Response {
  if (value !== null) {
    return value
  }
  return new Response('null', { headers: { 'content-type': 'application/json' } })
}

function workspaceFileNotFound(message: string): never {
  throw new AppError({
    code: 'workspace_file_not_found',
    status: 404,
    message,
  })
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return body
}

export const workspace = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['workspace'] },
})
  .get('', () => Workspace.list(), {
    detail: {
      'summary': 'List workspaces',
      'x-cradle-cli': {
        command: ['workspace', 'list'],
      },
    },
    response: { 200: t.Array(WorkspaceModel.record) },
  })
  .post('', ({ body }) => Workspace.create({
    name: trimValue(body.name),
    locator: {
      ...body.locator,
      hostId: trimValue(body.locator.hostId),
      path: trimValue(body.locator.path),
    },
    gitIdentity: body.gitIdentity,
  }), {
    detail: {
      'summary': 'Create workspace',
      'x-cradle-cli': {
        command: ['workspace', 'create'],
      },
    },
    body: WorkspaceModel.createBody,
    response: { 200: WorkspaceModel.record, 409: WorkspaceModel.locatorExistsError },
  })
  .post('/from-directory', ({ body }) => Workspace.addFromDirectory(trimValue(body.path)), {
    detail: {
      'summary': 'Import workspace from directory',
      'x-cradle-cli': {
        command: ['workspace', 'import'],
      },
    },
    body: WorkspaceModel.importBody,
    response: { 200: WorkspaceModel.record, 409: WorkspaceModel.locatorExistsError },
  })
  .post('/inspect-directory', ({ body }) => Workspace.inspectDirectory(trimValue(body.path)), {
    detail: {
      'summary': 'Inspect directory for Cradle Workspace recognition',
      'description': 'Read-only probe that reports whether the directory contains a cradle-workspace.json, whether it is valid, and what action Cradle would take. Does not create anything.',
      'x-cradle-cli': {
        command: ['workspace', 'inspect'],
      },
    },
    body: WorkspaceModel.inspectBody,
    response: { 200: WorkspaceModel.inspectionResult },
  })
  .post('/multi-folder', ({ body }) => Workspace.createMultiFolderWorkspace({
    name: trimValue(body.name),
    folders: body.folders.map(folder => ({
      name: trimValue(folder.name),
      path: trimValue(folder.path),
    })),
  }), {
    detail: {
      'summary': 'Create multi-folder workspace',
      'description': 'Create a Cradle-owned symlink workspace under the multi-workspace root from explicit folder entries. Requires the multi-workspace POC feature flag.',
      'x-cradle-cli': {
        command: ['workspace', 'multi-folder', 'create'],
      },
    },
    body: WorkspaceModel.multiFolderWorkspaceBody,
    response: { 200: WorkspaceModel.record, 409: WorkspaceModel.locatorExistsError },
  })
  .post('/multi-folder/from-config', ({ body }) => Workspace.createMultiFolderWorkspaceFromConfigPath(trimValue(body.path)), {
    detail: {
      'summary': 'Import multi-folder workspace config',
      'description': 'Read a cradle-workspace.json file and create a Cradle-owned symlink workspace. Requires the multi-workspace POC feature flag.',
      'x-cradle-cli': {
        command: ['workspace', 'multi-folder', 'import'],
      },
    },
    body: WorkspaceModel.multiFolderWorkspaceImportBody,
    response: { 200: WorkspaceModel.record, 409: WorkspaceModel.locatorExistsError },
  })
  .get('/resolve', ({ query }) => nullableJsonResponse(Workspace.resolveByLocator({
    hostId: trimValue(query.hostId),
    path: trimValue(query.path),
  })), {
    detail: {
      'summary': 'Resolve workspace by locator',
      'x-cradle-cli': {
        command: ['workspace', 'resolve'],
      },
    },
    query: WorkspaceModel.resolveQuery,
    response: { 200: WorkspaceModel.nullableRecord },
  })
  .get('/:workspaceId/files', ({ params }) => Workspace.getFiles(params.workspaceId), {
    detail: {
      'summary': 'List workspace files',
      'x-cradle-cli': {
        command: ['workspace', 'files'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    response: { 200: t.Array(WorkspaceModel.fileEntry) },
  })
  .get('/:workspaceId/files/children', ({ params, query }) => Workspace.getFileChildren(params.workspaceId, query.path ? trimValue(query.path) : ''), {
    detail: {
      summary: 'List workspace file children',
    },
    params: WorkspaceModel.workspaceIdParams,
    query: WorkspaceModel.fileChildrenQuery,
    response: { 200: t.Array(WorkspaceModel.fileEntry) },
  })
  .get('/:workspaceId/files/search', ({ params, query }) => Workspace.searchFiles(params.workspaceId, {
    query: query.q ? trimValue(query.q) : '',
    limit: query.limit,
  }), {
    detail: {
      summary: 'Search workspace files',
    },
    params: WorkspaceModel.workspaceIdParams,
    query: WorkspaceModel.fileSearchQuery,
    response: { 200: t.Array(WorkspaceModel.fileEntry) },
  })
  .get('/:workspaceId/files/events', ({ params }) => {
    return new Response(Workspace.openFileEvents(params.workspaceId), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: {
      summary: 'Subscribe to workspace file changes',
      responses: {
        200: {
          description: 'Server-sent event stream of workspace directory refresh hints for loaded file tree directories.',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
              example: 'data: {"type":"directory-changed","workspaceId":"workspace-1","path":"src","timestamp":1710000000000}\n\n',
            },
          },
        },
      },
    },
    params: WorkspaceModel.workspaceIdParams,
  })
  .get('/:workspaceId/files/content', async ({ params, query }) => {
    const content = await Workspace.getFileContent(params.workspaceId, trimValue(query.path))
    return { content }
  }, {
    detail: {
      'summary': 'Read workspace file content',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'read'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    query: WorkspaceModel.fileContentQuery,
    response: { 200: WorkspaceModel.readFileResponse },
  })
  .get('/:workspaceId/files/info', async ({ params, query }) => {
    const info = await Workspace.getFileInfo(params.workspaceId, trimValue(query.path))
    return info ?? workspaceFileNotFound('Workspace file was not found.')
  }, {
    detail: {
      summary: 'Get workspace file preview metadata',
    },
    params: WorkspaceModel.workspaceIdParams,
    query: WorkspaceModel.fileInfoQuery,
    response: { 200: WorkspaceModel.fileInfoResponse },
  })
  .get('/:workspaceId/files/raw', async ({ params, query }) => {
    const result = await Workspace.getFileBytes(params.workspaceId, trimValue(query.path))
    if (!result) {
      workspaceFileNotFound('Workspace file was not found.')
    }
    return new Response(responseBody(result.bytes), {
      headers: {
        'content-type': result.info.mimeType,
        'cache-control': 'no-store',
        'content-length': String(result.bytes.byteLength),
      },
    })
  }, {
    detail: {
      summary: 'Read workspace file bytes for preview',
    },
    params: WorkspaceModel.workspaceIdParams,
    query: WorkspaceModel.fileInfoQuery,
  })
  .get('/:workspaceId/files/rendition/pdf', async ({ params, query }) => {
    try {
      const result = await Workspace.getFilePdfRendition(params.workspaceId, trimValue(query.path))
      if (!result) {
        workspaceFileNotFound('Workspace file PDF rendition was not found.')
      }
      return new Response(responseBody(result.bytes), {
        headers: {
          'content-type': 'application/pdf',
          'cache-control': 'no-store',
          'content-length': String(result.bytes.byteLength),
          'x-cradle-rendition-source': result.source,
        },
      })
    }
    catch (error) {
      if (error instanceof AppError) {
        throw error
      }
      return new Response(JSON.stringify({
        code: 'workspace_file_rendition_failed',
        message: error instanceof Error ? error.message : 'Workspace file PDF rendition failed.',
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      })
    }
  }, {
    detail: {
      summary: 'Render workspace file as PDF for preview',
    },
    params: WorkspaceModel.workspaceIdParams,
    query: WorkspaceModel.fileInfoQuery,
  })
  .put('/:workspaceId/files/content', async ({ params, body }) => {
    return Workspace.setFileContent({
      workspaceId: params.workspaceId,
      relativePath: trimValue(body.path),
      content: body.content,
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Write workspace file content',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'write'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    body: WorkspaceModel.writeFileBody,
    response: { 200: WorkspaceModel.writeFileResponse },
  })
  .post('/:workspaceId/files/file', async ({ params, body }) => {
    return Workspace.createFile({
      workspaceId: params.workspaceId,
      relativePath: trimValue(body.path),
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Create workspace file',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'create'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    body: WorkspaceModel.createFileBody,
    response: { 200: WorkspaceModel.fileOperationResponse },
  })
  .post('/:workspaceId/files/folder', async ({ params, body }) => {
    return Workspace.createFolder({
      workspaceId: params.workspaceId,
      relativePath: trimValue(body.path),
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Create workspace folder',
      'x-cradle-cli': {
        command: ['workspace', 'folder', 'create'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    body: WorkspaceModel.createFolderBody,
    response: { 200: WorkspaceModel.fileOperationResponse },
  })
  .patch('/:workspaceId/files/path', async ({ params, body }) => {
    return Workspace.renameFilePath({
      workspaceId: params.workspaceId,
      sourcePath: trimValue(body.sourcePath),
      destinationPath: trimValue(body.destinationPath),
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Rename workspace file path',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'rename'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    body: WorkspaceModel.renameFileBody,
    response: { 200: WorkspaceModel.renameFileResponse },
  })
  .get('/:workspaceId', ({ params }) => nullableJsonResponse(Workspace.get(params.workspaceId)), {
    detail: {
      'summary': 'Get workspace',
      'x-cradle-cli': {
        command: ['workspace', 'get'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    response: { 200: WorkspaceModel.nullableRecord },
  })
  .patch('/:workspaceId', ({ params, body }) => {
    if (body.name === undefined && body.pinned === undefined) {
      throw new AppError({
        code: 'invalid_workspace_input',
        status: 400,
        message: 'at least one of name or pinned is required',
      })
    }

    return nullableJsonResponse(Workspace.update({
      id: params.workspaceId,
      name: body.name === undefined ? undefined : trimValue(body.name),
      pinned: body.pinned,
    }))
  }, {
    detail: {
      'summary': 'Update workspace',
      'x-cradle-cli': {
        command: ['workspace', 'update'],
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    body: WorkspaceModel.updateBody,
    response: { 200: WorkspaceModel.nullableRecord },
  })
  .delete('/:workspaceId', ({ params }) => {
    Workspace.remove(params.workspaceId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete workspace',
      'x-cradle-cli': {
        command: ['workspace', 'delete'],
      },
    },
    params: WorkspaceModel.workspaceIdParams,
    response: { 200: WorkspaceModel.deleteResponse },
  })
