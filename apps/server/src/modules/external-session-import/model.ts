import { t } from 'elysia'

const sourceApp = t.Union([
  t.Literal('claude'),
  t.Literal('codex'),
  t.Literal('kimi'),
  t.Literal('opencode'),
])
const nullableString = t.Nullable(t.String())
const nullableNumber = t.Nullable(t.Number())
const availability = t.Union([
  t.Literal('available'),
  t.Literal('missing'),
  t.Literal('remote'),
])

const workspacePlan = t.Object({
  kind: t.Union([t.Literal('existing'), t.Literal('create')]),
  reason: t.Union([
    t.Literal('exact-path'),
    t.Literal('containing-path'),
    t.Literal('git-identity'),
    t.Literal('import-record'),
    t.Literal('available-project-root'),
    t.Literal('offline-historical-root'),
  ]),
  historicalKey: t.String(),
  workspaceId: nullableString,
  name: t.String(),
  path: t.String(),
  availability,
}, { additionalProperties: false })

const candidate = t.Object({
  candidateId: t.String(),
  sourceHostId: t.String(),
  sourceApp,
  externalSessionId: t.String(),
  sourceRevision: t.String(),
  title: t.String(),
  summary: nullableString,
  workspacePath: t.String(),
  createdAt: nullableNumber,
  updatedAt: nullableNumber,
  archived: t.Boolean(),
  estimatedBytes: nullableNumber,
  childSessionCount: nullableNumber,
  alreadyImported: t.Boolean(),
  importState: t.Union([
    t.Literal('available'),
    t.Literal('imported'),
    t.Literal('update-available'),
  ]),
  importRecordId: nullableString,
  workspacePlan,
}, { additionalProperties: false })

const scan = t.Object({
  id: t.String(),
  createdAt: t.Number(),
  candidates: t.Array(candidate),
  warnings: t.Array(t.String()),
}, { additionalProperties: false })

const importRecord = t.Object({
  id: t.String(),
  sourceHostId: t.String(),
  sourceApp,
  externalSessionId: t.String(),
  sourcePath: nullableString,
  sourceWorkspacePath: t.String(),
  sourceRevision: t.String(),
  contentHash: t.String(),
  sourceGitIdentityJson: t.String(),
  workspaceId: t.String(),
  sessionId: t.String(),
  fidelityJson: t.String(),
  checkpointJson: t.String(),
  status: t.Union([
    t.Literal('imported'),
    t.Literal('update-available'),
    t.Literal('error'),
  ]),
  statusReason: nullableString,
  importedAt: t.Number(),
  lastSyncedAt: t.Number(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
}, { additionalProperties: false })

const importResultItem = t.Object({
  candidateId: t.String(),
  status: t.Union([
    t.Literal('imported'),
    t.Literal('duplicate'),
    t.Literal('error'),
  ]),
  sessionId: nullableString,
  workspaceId: nullableString,
  recordId: nullableString,
  reason: nullableString,
}, { additionalProperties: false })

export const ExternalSessionImportModel = {
  sourceApp,
  workspacePlan,
  candidate,
  scan,
  importRecord,
  scanBody: t.Optional(t.Object({
    sourceHostId: t.Optional(t.String({ minLength: 1 })),
    sourceApps: t.Optional(t.Array(sourceApp)),
    limitPerSource: t.Optional(t.Number({ minimum: 1, maximum: 2_000 })),
  }, { additionalProperties: false })),
  scanParams: t.Object({
    scanId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  importBody: t.Object({
    scanId: t.String({ minLength: 1 }),
    candidateIds: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
  }, { additionalProperties: false }),
  syncParams: t.Object({
    importId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  syncBody: t.Object({
    scanId: t.String({ minLength: 1 }),
    candidateId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  syncResponse: t.Object({
    importId: t.String(),
    sessionId: t.String(),
    workspaceId: t.String(),
    status: t.Union([
      t.Literal('unchanged'),
      t.Literal('synced'),
      t.Literal('diverged'),
    ]),
    appendedMessages: t.Number(),
    reason: nullableString,
  }, { additionalProperties: false }),
  importResponse: t.Object({
    imported: t.Number(),
    duplicates: t.Number(),
    errors: t.Number(),
    items: t.Array(importResultItem),
  }, { additionalProperties: false }),
  recordsResponse: t.Array(importRecord),
} as const
