import { t } from 'elysia'

export const RecallModel = {
  queryBody: t.Object({
    chatSessionId: t.String({ minLength: 1 }),
    code: t.String({ minLength: 1 }),
  }),
  queryResponse: t.Object({
    kind: t.String(),
    result: t.Optional(t.Unknown()),
    error: t.Optional(t.String()),
  }),
}
