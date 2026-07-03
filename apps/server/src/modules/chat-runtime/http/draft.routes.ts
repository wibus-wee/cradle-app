import { Elysia } from 'elysia'

import {
  deleteComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from '../composer-drafts'
import { ChatRuntimeModel } from '../model'

export const chatRuntimeDraftRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  .get(
    '/composer-drafts/:surfaceId',
    ({ params }) => {
      return readComposerDraft(params.surfaceId)
    },
    {
      detail: {
        summary: 'Read a server-owned composer draft',
      },
      params: ChatRuntimeModel.composerDraftParams,
      response: { 200: ChatRuntimeModel.composerDraftResponse },
    },
  )
  .put(
    '/composer-drafts/:surfaceId',
    ({ params, body }) => {
      return writeComposerDraft({
        surfaceId: params.surfaceId,
        draft: body.draft,
      })
    },
    {
      detail: {
        summary: 'Write a server-owned composer draft with last-write-wins semantics',
      },
      params: ChatRuntimeModel.composerDraftParams,
      body: ChatRuntimeModel.composerDraftWriteBody,
      response: { 200: ChatRuntimeModel.composerDraftResponse },
    },
  )
  .delete(
    '/composer-drafts/:surfaceId',
    ({ params }) => {
      return deleteComposerDraft(params.surfaceId)
    },
    {
      detail: {
        summary: 'Delete a server-owned composer draft tombstone',
      },
      params: ChatRuntimeModel.composerDraftParams,
      response: { 200: ChatRuntimeModel.composerDraftResponse },
    },
  )
