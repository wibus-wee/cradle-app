import { t } from 'elysia'

const status = t.Union([
  t.Literal('queued'),
t.Literal('downloading'),
t.Literal('verifying'),
  t.Literal('completed'),
t.Literal('failed'),
t.Literal('cancelled'),
])

export const DownloadCenterModel = {
  task: t.Object({
    taskId: t.String(),
    scope: t.Literal('server'),
    owner: t.Object({ namespace: t.String(), resourceType: t.String(), resourceId: t.String(), displayName: t.String() }),
    fileName: t.String(),
    sourceId: t.Nullable(t.String()),
    status,
    transferredBytes: t.Number(),
    totalBytes: t.Nullable(t.Number()),
    attempts: t.Number(),
    maxAttempts: t.Number(),
    error: t.Nullable(t.Object({ code: t.String(), message: t.String(), retryable: t.Boolean() })),
    result: t.Nullable(t.Object({
      taskId: t.String(),
bytes: t.Number(),
      checksum: t.Object({ algorithm: t.Union([t.Literal('sha256'), t.Literal('sha512')]), expected: t.Nullable(t.String()), actual: t.String(), matched: t.Nullable(t.Boolean()) }),
    })),
    createdAt: t.String(),
updatedAt: t.String(),
startedAt: t.Nullable(t.String()),
finishedAt: t.Nullable(t.String()),
  }),
  idParams: t.Object({ id: t.String({ minLength: 1 }) }),
  listQuery: t.Object({
    status: t.Optional(status),
    ownerNamespace: t.Optional(t.String({ minLength: 1 })),
    ownerResourceType: t.Optional(t.String({ minLength: 1 })),
    ownerResourceId: t.Optional(t.String({ minLength: 1 })),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  }),
}
