import { Elysia } from 'elysia'

import { CodeActivityModel } from './model'
import * as CodeActivity from './service'

export const codeActivity = new Elysia({
  prefix: '/code-activity',
  detail: { tags: ['code-activity'] },
})
  .get('/sessions/:sessionId/events', ({ params, request }) => {
    return new Response(CodeActivity.openSessionEvents(params.sessionId, request.signal), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: {
      summary: 'Subscribe to session code activity',
      description: 'Streams metadata-only relative file changes from the chat session execution root. File contents and absolute paths are never included.',
      responses: {
        200: {
          description: 'Server-sent Code Activity source events.',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
              example: 'data: {"type":"file-changed","sessionId":"session-1","workspace":{"id":"workspace-1","name":"Cradle"},"file":{"relativePath":"src/index.ts"},"occurredAt":1710000000000}\n\n',
            },
          },
        },
      },
    },
    params: CodeActivityModel.sessionParams,
  })
