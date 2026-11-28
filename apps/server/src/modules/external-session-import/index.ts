import { Elysia } from 'elysia'

import * as ExternalSessionCatalog from './catalog'
import { ExternalSessionImportModel } from './model'
import * as ExternalSessionImport from './service'

export const externalSessionImport = new Elysia({
  prefix: '/external-session-import',
  detail: { tags: ['external-session-import'] },
})
  .post('/scans', ({ body }) => ExternalSessionCatalog.scanExternalSessions(body ?? {}), {
    detail: {
      'summary': 'Discover importable external Claude, Codex, Kimi, and OpenCode sessions',
      'x-cradle-cli': {
        command: ['external-session-import', 'scan'],
      },
    },
    body: ExternalSessionImportModel.scanBody,
    response: { 200: ExternalSessionImportModel.scan },
  })
  .get('/scans/:scanId', ({ params }) => ExternalSessionCatalog.getExternalSessionScan(params.scanId), {
    detail: {
      'summary': 'Read an external session import scan',
      'x-cradle-cli': {
        command: ['external-session-import', 'scan', 'get'],
      },
    },
    params: ExternalSessionImportModel.scanParams,
    response: { 200: ExternalSessionImportModel.scan },
  })
  .post('/imports', ({ body }) => ExternalSessionImport.importExternalSessions(body), {
    detail: {
      'summary': 'Import selected external sessions into recovered Cradle Workspaces',
      'x-cradle-cli': {
        command: ['external-session-import', 'import'],
      },
    },
    body: ExternalSessionImportModel.importBody,
    response: { 200: ExternalSessionImportModel.importResponse },
  })
  .get('/imports', () => ExternalSessionImport.listExternalSessionImports(), {
    detail: {
      'summary': 'List imported external sessions',
      'x-cradle-cli': {
        command: ['external-session-import', 'list'],
      },
    },
    response: { 200: ExternalSessionImportModel.recordsResponse },
  })
  .post('/imports/:importId/sync', ({ params, body }) => ExternalSessionImport.syncExternalSessionImport({
    importId: params.importId,
    scanId: body.scanId,
    candidateId: body.candidateId,
  }), {
    detail: {
      'summary': 'Synchronize appended provider history into an imported session',
      'x-cradle-cli': {
        command: ['external-session-import', 'sync'],
      },
    },
    params: ExternalSessionImportModel.syncParams,
    body: ExternalSessionImportModel.syncBody,
    response: { 200: ExternalSessionImportModel.syncResponse },
  })
