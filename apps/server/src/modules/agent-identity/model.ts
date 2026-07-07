import { t } from 'elysia'

const thinkingEffortEnum = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh'),
])

const runtimeKindSchema = t.String({ minLength: 1 })

const importCandidateSourceKindEnum = t.Union([
  t.Literal('cc-switch'),
  t.Literal('local-config'),
])

const importedRuntimeKindEnum = t.Union([
  t.Literal('claude-agent'),
  t.Literal('codex'),
  t.Literal('cli-tui'),
])

const importAppEnum = t.Union([
  t.Literal('claude'),
  t.Literal('codex'),
  t.Literal('gemini'),
  t.Literal('pi'),
  t.Literal('kimi'),
])

const nullableString = t.Union([t.String(), t.Null()])

const agentRecord = t.Object({
  id: t.String(),
  name: t.String(),
  description: nullableString,
  avatarUrl: nullableString,
  avatarStyle: t.String(),
  avatarSeed: t.String(),
  providerTargetId: nullableString,
  modelId: nullableString,
  thinkingEffort: thinkingEffortEnum,
  runtimeKind: runtimeKindSchema,
  configJson: t.String(),
  enabled: t.Boolean(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const nullableAgentRecord = t.Union([agentRecord, t.Null()])

const importSourceRefresh = t.Object({
  sourceKey: t.String(),
  sourceLabel: t.String(),
  status: t.Union([t.Literal('ok'), t.Literal('warning'), t.Literal('error')]),
  recordsSeen: t.Number(),
  recordsProjected: t.Number(),
  recordsMissing: t.Number(),
  message: nullableString,
})

const localConfigImportCandidate = t.Object({
  id: t.String(),
  app: importAppEnum,
  runtimeKind: importedRuntimeKindEnum,
  sourceKind: importCandidateSourceKindEnum,
  sourceLabel: t.String(),
  externalRecordId: t.String(),
  providerTargetId: nullableString,
  agentName: t.String(),
  resolvedProviderName: t.String(),
  name: t.String(),
  modelId: nullableString,
  endpoint: nullableString,
  executable: nullableString,
  iconSlug: nullableString,
  avatarUrl: nullableString,
  importable: t.Boolean(),
  alreadyConfigured: t.Boolean(),
  reason: nullableString,
  notes: t.Array(t.String()),
  agent: nullableAgentRecord,
})

const previewLocalConfigImportResult = t.Object({
  candidates: t.Array(localConfigImportCandidate),
  sourceRefreshes: t.Array(importSourceRefresh),
})

const importedAgentResult = t.Object({
  app: importAppEnum,
  candidateId: t.String(),
  sourceKind: importCandidateSourceKindEnum,
  externalRecordId: t.String(),
  providerTargetId: nullableString,
  runtimeKind: importedRuntimeKindEnum,
  status: t.Union([t.Literal('created'), t.Literal('existing'), t.Literal('skipped')]),
  reason: nullableString,
  agent: nullableAgentRecord,
})

export const AgentIdentityModel = {
  agent: agentRecord,

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    enabled: t.Optional(t.String()),
    providerTargetId: t.Optional(t.String()),
  }),

  createBody: t.Object({
    name: t.String({ minLength: 1 }),
    description: t.Optional(nullableString),
    avatarStyle: t.String({ minLength: 1 }),
    avatarSeed: t.String({ minLength: 1 }),
    providerTargetId: t.Optional(nullableString),
    modelId: t.Optional(nullableString),
    thinkingEffort: t.Optional(thinkingEffortEnum),
    runtimeKind: t.Optional(runtimeKindSchema),
    configJson: t.Optional(t.String()),
  }),

  updateBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(nullableString),
    avatarStyle: t.Optional(t.String({ minLength: 1 })),
    avatarSeed: t.Optional(t.String({ minLength: 1 })),
    providerTargetId: t.Optional(nullableString),
    modelId: t.Optional(nullableString),
    thinkingEffort: t.Optional(thinkingEffortEnum),
    runtimeKind: t.Optional(runtimeKindSchema),
    configJson: t.Optional(t.String()),
    enabled: t.Optional(t.Boolean()),
  }),

  importLocalConfigBody: t.Optional(t.Object({
    includeProcessEnv: t.Optional(t.Boolean()),
    candidateIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
  })),

  localConfigImportCandidate,

  previewLocalConfigImportResult,

  importLocalConfigResult: t.Object({
    preview: previewLocalConfigImportResult,
    created: t.Number(),
    existing: t.Number(),
    skipped: t.Number(),
    agents: t.Array(importedAgentResult),
  }),
}
