import { t } from 'elysia'

const priority = t.Union([
  t.Literal('low'),
  t.Literal('normal'),
  t.Literal('high'),
])

const status = t.Union([
  t.Literal('idle'),
  t.Literal('running'),
  t.Literal('succeeded'),
  t.Literal('failed'),
])

export const BackgroundActivityModel = {
  keyParams: t.Object({
    ownerNamespace: t.String({ minLength: 1 }),
    key: t.String({ minLength: 1 }),
  }),

  activity: t.Object({
    ownerNamespace: t.String(),
    key: t.String(),
    title: t.String(),
    priority,
    trigger: t.String(),
    manuallyRunnable: t.Boolean(),
    status,
    progress: t.Nullable(t.Any()),
    lastError: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    startedAt: t.Nullable(t.Number()),
    finishedAt: t.Nullable(t.Number()),
  }),
}
