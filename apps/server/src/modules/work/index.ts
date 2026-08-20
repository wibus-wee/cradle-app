import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { registerWorkHarnessContextSource } from './agent-context'
import { WorkModel } from './model'
import * as Work from './service'

registerWorkHarnessContextSource()

export const work = new Elysia({
  prefix: '/works',
  detail: { tags: ['work'] },
})
  .get('', async ({ query }) => await Work.listFresh(query), {
    detail: {
      'summary': 'List Work containers',
      'x-cradle-cli': { command: ['work', 'list'] },
    },
    query: WorkModel.listQuery,
    response: { 200: WorkModel.page },
  })
  .post('/node-projections/reconcile', async ({ body }) => {
    return await Work.reconcileNodeWorksForWorkspace(body.workspaceId)
  }, {
    detail: {
      'summary': 'Reconcile Works from a mounted Fabric Node workspace',
      'x-cradle-cli': { command: ['work', 'reconcile-node-projections'] },
    },
    body: WorkModel.reconcileNodeBody,
    response: { 200: WorkModel.reconcileNodeResponse },
  })
  .get('/attention', () => Work.listAttention(), {
    detail: {
      'summary': 'List actionable Work attention items',
      'x-cradle-cli': { command: ['work', 'attention'] },
    },
    response: { 200: t.Array(WorkModel.attentionItem) },
  })
  .get('/:id', async ({ params }) => {
    const detail = await Work.get(params.id)
    if (!detail) {
      throw new AppError({ code: 'work_not_found', status: 404, message: 'Work not found' })
    }
    return detail
  }, {
    detail: {
      'summary': 'Get Work detail',
      'x-cradle-cli': { command: ['work', 'get'] },
    },
    params: WorkModel.idParams,
    response: { 200: WorkModel.detail },
  })
  .post('', async ({ body }) => await Work.create(body), {
    detail: {
      'summary': 'Create isolated Work on the workspace authority',
      'x-cradle-cli': {
        command: ['work', 'create'],
        defaultWorkspaceId: true,
      },
    },
    body: WorkModel.createBody,
    response: { 200: WorkModel.detail },
  })
  .post('/:id/archive', async ({ params, body }) => await Work.setArchived({
    id: params.id,
    archived: body.archived,
  }), {
    detail: {
      'summary': 'Archive or restore Work',
      'x-cradle-cli': { command: ['work', 'archive'] },
    },
    params: WorkModel.idParams,
    body: WorkModel.archiveBody,
    response: { 200: WorkModel.detail },
  })
  .post('/:id/redetect', async ({ params }) => await Work.redetect(params.id), {
    detail: {
      'summary': 'Redetect Work state from authoritative owner facts',
      'x-cradle-cli': { command: ['work', 'redetect'] },
    },
    params: WorkModel.idParams,
    response: { 200: WorkModel.detail },
  })
  .post('/:id/prepare', async ({ params, body }) => await Work.prepare({
    id: params.id,
    ...body,
  }), {
    detail: {
      'summary': 'Prepare a Work handoff without publishing it',
      'x-cradle-cli': { command: ['work', 'prepare'] },
    },
    params: WorkModel.idParams,
    body: WorkModel.prepareBody,
    response: { 200: WorkModel.detail },
  })
  .post('/:id/submit', async ({ params, body }) => await Work.submit({
    id: params.id,
    ...body,
  }), {
    detail: {
      'summary': 'Explicitly create or update the Work draft pull request',
      'x-cradle-cli': { command: ['work', 'submit'] },
    },
    params: WorkModel.idParams,
    body: WorkModel.submitBody,
    response: { 200: WorkModel.detail },
  })
  .post('/:id/branch', async ({ params, body }) => await Work.renameBranch({
    id: params.id,
    branch: body.branch,
  }), {
    detail: {
      'summary': 'Rename the Work branch before the first pull request exists',
      'x-cradle-cli': { command: ['work', 'rename-branch'] },
    },
    params: WorkModel.idParams,
    body: WorkModel.renameBranchBody,
    response: { 200: WorkModel.detail },
  })

export const sessionWork = new Elysia({
  prefix: '/sessions',
  detail: { tags: ['work'] },
}).get('/:id/work', ({ params }) => ({
  work: Work.getBySessionId(params.id),
}), {
  detail: { summary: 'Resolve Work containing a Session' },
  params: WorkModel.idParams,
  response: { 200: WorkModel.sessionResolution },
})
