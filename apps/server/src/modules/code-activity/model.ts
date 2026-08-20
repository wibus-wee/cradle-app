import { t } from 'elysia'

export const CodeActivityModel = {
  sessionParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),
}
