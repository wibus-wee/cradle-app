import { t } from 'elysia'

const sourceApp = t.Union([
  t.Literal('claude'),
  t.Literal('codex'),
  t.Literal('cursor'),
  t.Literal('windsurf'),
  t.Literal('gemini'),
  t.Literal('unknown'),
])

const sourceScope = t.Union([
  t.Literal('server'),
  t.Literal('electron-upload'),
])

const sourceKind = t.Union([
  t.Literal('settings'),
  t.Literal('project'),
  t.Literal('session'),
  t.Literal('instruction'),
  t.Literal('mcp'),
  t.Literal('command'),
  t.Literal('hook'),
  t.Literal('skill'),
  t.Literal('plugin'),
  t.Literal('subagent'),
])

const importStatus = t.Union([
  t.Literal('pending'),
  t.Literal('imported'),
  t.Literal('duplicate'),
  t.Literal('skipped'),
  t.Literal('error'),
])

const previewItem = t.Object({
  id: t.String(),
  sourceApp,
  sourceScope,
  sourceKind,
  title: t.String(),
  summary: t.Nullable(t.String()),
  sourcePath: t.Nullable(t.String()),
  externalId: t.String(),
  fingerprint: t.String(),
  workspacePath: t.Nullable(t.String()),
  createdAt: t.Nullable(t.Number()),
  updatedAt: t.Nullable(t.Number()),
  duplicate: t.Boolean(),
  duplicateImportId: t.Nullable(t.String()),
  importable: t.Boolean(),
  reason: t.Nullable(t.String()),
  payloadJson: t.String(),
}, { additionalProperties: false })

const uploadFile = t.Object({
  sourceApp,
  path: t.String({ minLength: 1 }),
  content: t.String(),
  workspacePath: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  modifiedAt: t.Optional(t.Nullable(t.Number())),
}, { additionalProperties: false })

const importRecord = t.Object({
  id: t.String(),
  sourceApp,
  sourceScope,
  sourceKind,
  sourcePath: t.Nullable(t.String()),
  externalId: t.String(),
  fingerprint: t.String(),
  title: t.String(),
  summary: t.Nullable(t.String()),
  workspaceId: t.Nullable(t.String()),
  sessionId: t.Nullable(t.String()),
  messageId: t.Nullable(t.String()),
  status: t.Union([
    t.Literal('imported'),
    t.Literal('skipped'),
    t.Literal('error'),
  ]),
  statusReason: t.Nullable(t.String()),
  importedAt: t.Number(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
}, { additionalProperties: false })

const importResultItem = t.Object({
  fingerprint: t.String(),
  status: importStatus,
  record: t.Nullable(importRecord),
  sessionId: t.Nullable(t.String()),
  workspaceId: t.Nullable(t.String()),
  reason: t.Nullable(t.String()),
}, { additionalProperties: false })

export const ExternalWorkImportModel = {
  sourceApp,
  sourceScope,
  sourceKind,
  previewItem,
  previewBody: t.Optional(t.Object({
    includeHome: t.Optional(t.Boolean()),
    cwds: t.Optional(t.Array(t.String({ minLength: 1 }))),
    sourceApps: t.Optional(t.Array(sourceApp)),
    limitPerSource: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
  }, { additionalProperties: false })),
  uploadPreviewBody: t.Object({
    files: t.Array(uploadFile),
  }, { additionalProperties: false }),
  importBody: t.Object({
    items: t.Array(previewItem),
  }, { additionalProperties: false }),
  previewResponse: t.Object({
    items: t.Array(previewItem),
    warnings: t.Array(t.String()),
  }, { additionalProperties: false }),
  importResponse: t.Object({
    imported: t.Number(),
    duplicates: t.Number(),
    skipped: t.Number(),
    errors: t.Number(),
    items: t.Array(importResultItem),
  }, { additionalProperties: false }),
  recordsResponse: t.Array(importRecord),
} as const
