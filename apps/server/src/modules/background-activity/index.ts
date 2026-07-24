import { Elysia, t } from 'elysia'

import { BackgroundActivityModel } from './model'
import * as BackgroundActivity from './service'

export const backgroundActivity = new Elysia({
  prefix: '/background-activities',
  detail: { tags: ['background-activity'] },
})
  .get('', () => BackgroundActivity.list(), {
    detail: {
      'summary': 'List background activities',
      'x-cradle-cli': { command: ['background-activity', 'list'] },
    },
    response: { 200: t.Array(BackgroundActivityModel.activity) },
  })
  .post('/:ownerNamespace/:key/run', ({ params }) => {
    return BackgroundActivity.startManualRun(params.ownerNamespace, params.key)
  }, {
    detail: { summary: 'Run a background activity now' },
    params: BackgroundActivityModel.keyParams,
    response: { 200: BackgroundActivityModel.activity },
  })
