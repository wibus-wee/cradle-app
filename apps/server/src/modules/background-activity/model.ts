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

const footerPresentation = t.Object(
  {
    id: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    description: t.Nullable(t.String()),
    actionLabel: t.Nullable(t.String()),
    actionUrl: t.Nullable(t.String({ format: 'uri' })),
    expiresAt: t.Nullable(t.Number()),
  },
  { additionalProperties: false },
)

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
    presentation: t.Object(
      { footer: t.Nullable(footerPresentation) },
      { additionalProperties: false },
    ),
    lastError: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    startedAt: t.Nullable(t.Number()),
    finishedAt: t.Nullable(t.Number()),
  }),
}
