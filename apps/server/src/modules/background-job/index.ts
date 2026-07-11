import { Elysia, t } from 'elysia'

import { BackgroundJobModel } from './model'
import { registerSourceAdapter } from './registry'
import * as BackgroundJob from './service'
import { chatRuntimeSourceAdapter } from './sources/chat-runtime'

registerSourceAdapter(chatRuntimeSourceAdapter)

export const backgroundJob = new Elysia({
  prefix: '/background-jobs',
  detail: { tags: ['background-job'] },
})
  .get(
    '/',
    async ({ query }) => {
      await BackgroundJob.reconcile(query)
      return BackgroundJob.list(query)
    },
    {
      detail: {
        'summary': 'List background jobs',
        'x-cradle-cli': { command: ['background-job', 'list'] },
      },
      query: BackgroundJobModel.listQuery,
      response: { 200: t.Array(BackgroundJobModel.job) },
    },
  )
  .get('/:id', async ({ params }) => BackgroundJob.reconcileOne(params.id), {
    detail: {
      'summary': 'Get background job',
      'x-cradle-cli': { command: ['background-job', 'get'] },
    },
    params: BackgroundJobModel.idParams,
    response: { 200: BackgroundJobModel.job },
  })
  .post('/:id/cancel', ({ params }) => BackgroundJob.cancel(params.id), {
    detail: {
      'summary': 'Cancel background job',
      'x-cradle-cli': { command: ['background-job', 'cancel'] },
    },
    params: BackgroundJobModel.idParams,
    response: { 200: BackgroundJobModel.job },
  })
