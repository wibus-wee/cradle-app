import { t } from 'elysia'

const nativeStorageStatus = t.Union([
  t.Literal('deleted'),
  t.Literal('partial'),
  t.Literal('preserved'),
  t.Literal('not_applicable'),
  t.Literal('failed'),
])

const storageCategory = t.Object({
  id: t.Union([
    t.Literal('database'),
    t.Literal('runtime'),
    t.Literal('attachments'),
    t.Literal('artifacts'),
    t.Literal('terminal'),
    t.Literal('diagnostics'),
    t.Literal('other'),
  ]),
  bytes: t.Number(),
  fileCount: t.Number(),
})

const storageSession = t.Object({
  id: t.String(),
  title: t.String(),
  workspaceName: t.Nullable(t.String()),
  runtimeKind: t.String(),
  updatedAt: t.Number(),
  archivedAt: t.Nullable(t.Number()),
  pinned: t.Boolean(),
  active: t.Boolean(),
  messageCount: t.Number(),
  localBytes: t.Number(),
  runtimeBytes: t.Number(),
  attachmentBytes: t.Number(),
  artifactBytes: t.Number(),
  terminalBytes: t.Number(),
  reclaimableBytes: t.Number(),
})

const overview = t.Object({
  measuredAt: t.Number(),
  dataDirectory: t.String(),
  totalBytes: t.Number(),
  categories: t.Array(storageCategory),
  sessions: t.Array(storageSession),
})

const cleanupResult = t.Object({
  sessionId: t.String(),
  nativeStorage: t.Object({
    status: nativeStorageStatus,
    detail: t.Optional(t.String()),
  }),
  attachmentBytesFreed: t.Number(),
})

const compaction = t.Union([
  t.Object({
    status: t.Literal('completed'),
    bytesBefore: t.Number(),
    bytesAfter: t.Number(),
  }),
  t.Object({ status: t.Literal('deferred'), reason: t.Literal('insufficient_space') }),
  t.Object({ status: t.Literal('not_applicable') }),
  t.Object({ status: t.Literal('skipped_active_runs') }),
])

export const StorageModel = {
  overview,
  sessionIdsBody: t.Object({
    sessionIds: t.Array(t.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
  }),
  mutationResult: t.Object({
    cleanup: t.Array(cleanupResult),
    compaction,
    overview,
  }),
}

export type StorageOverview = typeof overview.static
export type StorageCleanupResult = typeof cleanupResult.static
export type StorageCompaction = typeof compaction.static
