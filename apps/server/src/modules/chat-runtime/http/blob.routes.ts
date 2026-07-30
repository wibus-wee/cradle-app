import { Elysia } from 'elysia'

import { readSessionMessageBlob } from '../message-blob-content'
import { ChatRuntimeModel } from '../model'

export const chatRuntimeBlobRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  .get('/sessions/:sessionId/blobs/:blobId/content', async ({ params }) => {
    const blob = await readSessionMessageBlob(params.sessionId, params.blobId)
    return new Response(new Uint8Array(blob.bytes), {
      headers: {
        'content-type': blob.mediaType,
        'content-length': String(blob.byteSize),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }, {
    detail: {
      summary: 'Read chat message blob content',
      description: 'Return bytes referenced by a message in this chat session. Linked sessions proxy this route to their upstream Cradle server.',
    },
    params: ChatRuntimeModel.sessionBlobParams,
  })
