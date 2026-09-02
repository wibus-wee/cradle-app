import { Elysia } from 'elysia'

import { StorageModel } from './model'
import * as Storage from './service'

export const storage = new Elysia({
  prefix: '/storage',
  detail: { tags: ['storage'] },
})
  .get('/overview', () => Storage.getStorageOverview(), {
    detail: { summary: 'Read the latest Cradle-owned storage measurement' },
    response: { 200: StorageModel.overview },
  })
  .post('/sessions/purge-transcripts', async ({ body }) => {
    return await Storage.purgeTranscripts(body.sessionIds)
  }, {
    detail: { summary: 'Delete local transcripts and reset provider runtime sessions' },
    body: StorageModel.sessionIdsBody,
    response: { 200: StorageModel.mutationResult },
  })
  .post('/sessions/delete', async ({ body }) => {
    return await Storage.deleteSessions(body.sessionIds)
  }, {
    detail: { summary: 'Delete sessions and all Cradle-owned session data' },
    body: StorageModel.sessionIdsBody,
    response: { 200: StorageModel.mutationResult },
  })
