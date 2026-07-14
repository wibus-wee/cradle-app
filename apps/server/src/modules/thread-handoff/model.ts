import { t } from 'elysia'

import { SessionModel } from '../session/model'

const handoff = t.Object({
  id: t.String(),
  requestId: t.String(),
  sourceSessionId: t.String(),
  destinationSessionId: t.String(),
  sourceProviderTargetId: t.Nullable(t.String()),
  destinationProviderTargetId: t.String(),
  importedMessageCount: t.Number(),
  createdAt: t.Number(),
})

export const ThreadHandoffModel = {
  handoff,
  createBody: t.Object({
    requestId: t.String({ minLength: 1 }),
    sourceSessionId: t.String({ minLength: 1 }),
    destinationProviderTargetId: t.String({ minLength: 1 }),
    modelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    thinkingEffort: t.Optional(t.Nullable(t.Union([
      t.Literal('none'),
      t.Literal('minimal'),
      t.Literal('low'),
      t.Literal('medium'),
      t.Literal('high'),
      t.Literal('xhigh'),
      t.Literal('max'),
    ]))),
  }, { additionalProperties: false }),
  createResponse: t.Object({ handoff, session: SessionModel.session }),
  destinationParams: t.Object({ sessionId: t.String({ minLength: 1 }) }),
}
