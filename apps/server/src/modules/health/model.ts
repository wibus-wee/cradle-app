import { t } from 'elysia'

export const HealthModel = {
  checkResponse: t.Object({
    status: t.Literal('ok'),
    uptime: t.Number(),
    memory: t.Object({
      heapUsed: t.Number(),
      heapTotal: t.Number(),
      rss: t.Number(),
      external: t.Number(),
    }),
    cpu: t.Object({
      percent: t.Nullable(t.Number()),
      userMicros: t.Number(),
      systemMicros: t.Number(),
      sampleMs: t.Nullable(t.Number()),
      usedMicros: t.Nullable(t.Number()),
      windowReady: t.Boolean(),
    }),
    timestamp: t.Number(),
  }),
} as const
