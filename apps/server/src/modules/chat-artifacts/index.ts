import { Elysia, t } from 'elysia'

import { ChatArtifactsModel } from './model'
import * as ChatArtifacts from './service'

export const chatArtifacts = new Elysia({
  prefix: '/chat-artifacts',
  detail: { tags: ['chat-artifacts'] },
})
  .post(
    '',
    ({ body }) => ChatArtifacts.upsertArtifact({
      sessionId: body.chatSessionId,
      artifactId: body.artifactId,
      title: body.title,
      source: body.source,
    }),
    {
      detail: {
        summary: 'Create or update a session Artifact (JSX source)',
      },
      body: ChatArtifactsModel.upsertBody,
      response: { 200: ChatArtifactsModel.record },
    },
  )
  .get(
    '/:sessionId',
    ({ params }) => ChatArtifacts.listArtifacts(params.sessionId),
    {
      detail: {
        summary: 'List Artifacts for a chat session',
      },
      params: ChatArtifactsModel.sessionParams,
      response: { 200: t.Array(ChatArtifactsModel.record) },
    },
  )
  .get(
    '/:sessionId/:artifactId',
    ({ params }) => ChatArtifacts.getArtifact(params.sessionId, params.artifactId),
    {
      detail: {
        summary: 'Get one Artifact by session and id',
      },
      params: ChatArtifactsModel.artifactParams,
      response: { 200: ChatArtifactsModel.record },
    },
  )
