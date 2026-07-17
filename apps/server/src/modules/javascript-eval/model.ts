import { t } from 'elysia'

export const JavaScriptEvalModel = {
  evaluateBody: t.Object({
    program: t.String({ minLength: 1 }),
    timeoutMs: t.Optional(t.Number()),
    cwd: t.Optional(t.String()),
  }),

  evaluateResponse: t.Object({
    ok: t.Boolean(),
    result: t.Optional(t.Unknown()),
    error: t.Optional(t.String()),
    kind: t.Optional(t.String()),
  }),
}
