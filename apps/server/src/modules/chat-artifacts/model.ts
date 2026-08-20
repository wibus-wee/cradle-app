import { t } from 'elysia'

export const ChatArtifactsModel = {
  upsertBody: t.Object({
    chatSessionId: t.String({ minLength: 1 }),
    artifactId: t.Optional(t.String({ minLength: 1 })),
    title: t.String({ minLength: 1, maxLength: 200 }),
    source: t.String({ minLength: 1 }),
  }),
  sessionParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),
  artifactParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    artifactId: t.String({ minLength: 1 }),
  }),
  record: t.Object({
    id: t.String(),
    sessionId: t.String(),
    title: t.String(),
    source: t.String(),
    revision: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),
}

export type ChatArtifactUpsertBody = typeof ChatArtifactsModel.upsertBody.static
export type ChatArtifactRecordDto = typeof ChatArtifactsModel.record.static
