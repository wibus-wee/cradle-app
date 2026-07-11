import { t } from 'elysia'

const status = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('succeeded'),
  t.Literal('failed'),
  t.Literal('cancelled'),
])

export const BackgroundJobModel = {
  idParams: t.Object(
    {
      id: t.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),

  listQuery: t.Object(
    {
      workspaceId: t.Optional(t.String({ minLength: 1 })),
      ownerNamespace: t.Optional(t.String({ minLength: 1 })),
      ownerResourceType: t.Optional(t.String({ minLength: 1 })),
      ownerResourceId: t.Optional(t.String({ minLength: 1 })),
      ownerResourceKey: t.Optional(t.String({ minLength: 1 })),
      kind: t.Optional(t.String({ minLength: 1 })),
      status: t.Optional(status),
      limit: t.Optional(t.Number({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),

  job: t.Object({
    id: t.String(),
    workspaceId: t.Nullable(t.String()),
    ownerNamespace: t.String(),
    ownerResourceType: t.String(),
    ownerResourceId: t.String(),
    ownerResourceKey: t.Nullable(t.String()),
    kind: t.String(),
    status,
    sourceKind: t.String(),
    sourceSessionId: t.Nullable(t.String()),
    sourceRunId: t.Nullable(t.String()),
    attempts: t.Number(),
    maxAttempts: t.Number(),
    context: t.Any(),
    progress: t.Nullable(t.Any()),
    result: t.Nullable(t.Any()),
    errorCode: t.Nullable(t.String()),
    errorMessage: t.Nullable(t.String()),
    errorDetails: t.Nullable(t.Any()),
    cancelRequestedAt: t.Nullable(t.Number()),
    startedAt: t.Nullable(t.Number()),
    finishedAt: t.Nullable(t.Number()),
    projectedAt: t.Nullable(t.Number()),
    projectionAttempts: t.Number(),
    projectionError: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),
}
