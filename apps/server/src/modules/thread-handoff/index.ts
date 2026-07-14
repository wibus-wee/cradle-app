import { Elysia, t } from 'elysia'

import { ThreadHandoffModel } from './model'
import * as ThreadHandoff from './service'

export const threadHandoff = new Elysia({
  prefix: '/thread-handoffs',
  detail: { tags: ['thread-handoff'] },
})
  .post('', ({ body }) => ThreadHandoff.create(body), {
    detail: {
      'summary': 'Hand off a chat thread to another provider target',
      'x-cradle-cli': { command: ['chat', 'handoff', 'create'], defaultChatSessionId: true },
    },
    body: ThreadHandoffModel.createBody,
    response: { 200: ThreadHandoffModel.createResponse },
  })
  .get('/destination/:sessionId', ({ params }) => ThreadHandoff.getByDestinationSessionId(params.sessionId), {
    detail: {
      'summary': 'Get handoff provenance for a destination session',
      'x-cradle-cli': { command: ['chat', 'handoff', 'get'], defaultChatSessionId: true },
    },
    params: ThreadHandoffModel.destinationParams,
    response: { 200: t.Nullable(ThreadHandoffModel.handoff) },
  })
