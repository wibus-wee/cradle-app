import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { DownloadCenterModel } from './model'
import { DownloadCenterService } from './service'

type OpenApiEventSchema = {
  type: 'string' | 'number' | 'boolean' | 'object'
  nullable?: boolean
  enum?: string[]
  required?: string[]
  properties?: Record<string, OpenApiEventSchema>
}

const downloadTaskEventSchema: OpenApiEventSchema = {
  type: 'object',
  required: ['taskId', 'scope', 'owner', 'fileName', 'sourceId', 'status', 'transferredBytes', 'totalBytes', 'attempts', 'maxAttempts', 'error', 'result', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt'],
  properties: {
    taskId: { type: 'string' },
    scope: { type: 'string', enum: ['server'] },
    owner: { type: 'object', required: ['namespace', 'resourceType', 'resourceId', 'displayName'], properties: { namespace: { type: 'string' }, resourceType: { type: 'string' }, resourceId: { type: 'string' }, displayName: { type: 'string' } } },
    fileName: { type: 'string' },
sourceId: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['queued', 'downloading', 'verifying', 'completed', 'failed', 'cancelled'] },
    transferredBytes: { type: 'number' },
totalBytes: { type: 'number', nullable: true },
attempts: { type: 'number' },
maxAttempts: { type: 'number' },
    error: { type: 'object', nullable: true, required: ['code', 'message', 'retryable'], properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } } },
    result: { type: 'object', nullable: true, required: ['taskId', 'bytes', 'checksum'], properties: { taskId: { type: 'string' }, bytes: { type: 'number' }, checksum: { type: 'object', required: ['algorithm', 'expected', 'actual', 'matched'], properties: { algorithm: { type: 'string', enum: ['sha256', 'sha512'] }, expected: { type: 'string', nullable: true }, actual: { type: 'string' }, matched: { type: 'boolean', nullable: true } } } } },
    createdAt: { type: 'string' },
updatedAt: { type: 'string' },
startedAt: { type: 'string', nullable: true },
finishedAt: { type: 'string', nullable: true },
  },
}

export function createDownloadCenterModule(service = new DownloadCenterService()) {
  const routes = new Elysia({ prefix: '/download-center', detail: { tags: ['download-center'] } })
    .get('/tasks', ({ query }) => service.list(query), {
      detail: { 'summary': 'List download tasks', 'x-cradle-cli': { command: ['download-center', 'list'] } },
      query: DownloadCenterModel.listQuery,
      response: { 200: t.Array(DownloadCenterModel.task) },
    })
    .get('/tasks/:id', ({ params }) => {
      const task = service.get(params.id)
      if (!task) { throw new AppError({ code: 'download_not_found', status: 404, message: 'Download task was not found.' }) }
      return task
    }, {
      detail: { 'summary': 'Get a download task', 'x-cradle-cli': { command: ['download-center', 'get'] } },
      params: DownloadCenterModel.idParams,
      response: { 200: DownloadCenterModel.task },
    })
    .post('/tasks/:id/cancel', ({ params }) => {
      const task = service.cancel(params.id)
      if (!task) { throw new AppError({ code: 'download_not_cancellable', status: 409, message: 'The download task was not found or is already terminal.' }) }
      return task
    }, {
      detail: { 'summary': 'Cancel a download task', 'x-cradle-cli': { command: ['download-center', 'cancel'] } },
      params: DownloadCenterModel.idParams,
      response: { 200: DownloadCenterModel.task },
    })
    .get('/events', ({ request }) => new Response(service.events.stream(request.signal), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' },
    }), {
      detail: {
        summary: 'Subscribe to download task changes',
        responses: { 200: { description: 'Task changes only; fetch /download-center/tasks for the initial snapshot.', content: { 'text/event-stream': { schema: downloadTaskEventSchema } } } },
      },
    })
  return { routes, service }
}
