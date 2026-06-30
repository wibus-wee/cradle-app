import { Elysia } from 'elysia'

import { ExternalWorkImportModel } from './model'
import * as ExternalWorkImport from './service'

export const externalWorkImport = new Elysia({
  prefix: '/external-work-import',
  detail: { tags: ['external-work-import'] },
})
  .get('/records', () => ExternalWorkImport.listRecords(), {
    detail: {
      summary: 'List external work import records',
    },
    response: { 200: ExternalWorkImportModel.recordsResponse },
  })
  .post('/preview', ({ body }) => ExternalWorkImport.preview(body ?? {}), {
    detail: {
      summary: 'Preview importable work from server-local AI applications',
    },
    body: ExternalWorkImportModel.previewBody,
    response: { 200: ExternalWorkImportModel.previewResponse },
  })
  .post('/upload-preview', ({ body }) => ExternalWorkImport.uploadPreview(body), {
    detail: {
      summary: 'Preview importable work from uploaded Electron-local AI application files',
    },
    body: ExternalWorkImportModel.uploadPreviewBody,
    response: { 200: ExternalWorkImportModel.previewResponse },
  })
  .post('/import', ({ body }) => ExternalWorkImport.importItems(body.items), {
    detail: {
      summary: 'Import external AI application work into Cradle',
    },
    body: ExternalWorkImportModel.importBody,
    response: { 200: ExternalWorkImportModel.importResponse },
  })
