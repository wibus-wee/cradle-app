import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })

const skillScope = t.Union([
  t.Literal('builtin'),
  t.Literal('legacy'),
  t.Literal('global'),
  t.Literal('repository'),
  t.Literal('workspace'),
  t.Literal('agent'),
])

const skillInventoryEntry = t.Object({
  name: t.String(),
  description: t.Nullable(t.String()),
  location: t.String(),
  scope: skillScope,
  rootDir: t.String(),
  skillDir: t.String(),
  active: t.Boolean(),
  shadowedBy: t.Nullable(skillScope),
})

const skillDocument = t.Object({
  name: t.String(),
  description: t.Nullable(t.String()),
  location: t.String(),
  scope: skillScope,
  rootDir: t.String(),
  skillDir: t.String(),
  body: t.String(),
  frontmatter: t.Record(t.String(), t.Unknown()),
})

const discoveredSkill = t.Object({
  skillDir: t.String(),
  relativePath: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
})

const skillSource = t.Object({
  type: t.Union([
    t.Literal('github'),
    t.Literal('gitlab'),
    t.Literal('git'),
    t.Literal('local'),
  ]),
  url: t.String(),
  ref: t.Optional(t.String()),
  subpath: t.Optional(t.String()),
  label: t.String(),
})

const fetchSourceResult = t.Object({
  sessionId: t.String(),
  source: skillSource,
  skills: t.Array(discoveredSkill),
})

const importFromFetchResult = t.Object({
  imported: t.Array(skillDocument),
  errors: t.Array(t.Object({
    dir: t.String(),
    error: t.String(),
  })),
})

const okResponse = t.Object({ ok: t.Literal(true) })

const exportOwnerBoundary = t.Object({
  classification: t.Literal('non-cradle-owned'),
  owner: t.Literal('user-selected-export-directory'),
  consentRequired: t.Literal(true),
  consentConfirmed: t.Literal(true),
  destinationDir: t.String(),
  targetPath: t.String(),
}, { additionalProperties: false })

export const SkillsModel = {
  skillScope,
  skillInventoryEntry,
  skillDocument,
  skillSource,
  fetchSourceResult,
  importFromFetchResult,
  okResponse,

  listQuery: t.Object({
    workspaceId: t.Optional(nonBlankString),
    agentId: t.Optional(nonBlankString),
  }),

  lookupQuery: t.Object({
    scope: skillScope,
    name: nonBlankString,
    workspaceId: t.Optional(nonBlankString),
    agentId: t.Optional(nonBlankString),
  }),

  createBody: t.Object({
    scope: skillScope,
    name: nonBlankString,
    description: nonBlankString,
    body: t.String(),
    workspaceId: t.Optional(t.Nullable(nonBlankString)),
    agentId: t.Optional(t.Nullable(nonBlankString)),
    frontmatter: t.Optional(t.Record(t.String(), t.Unknown())),
  }),

  updateBody: t.Object({
    scope: skillScope,
    name: nonBlankString,
    workspaceId: t.Optional(t.Nullable(nonBlankString)),
    agentId: t.Optional(t.Nullable(nonBlankString)),
    document: t.Object({
      name: nonBlankString,
      description: nonBlankString,
      body: t.String(),
      frontmatter: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  }),

  importBody: t.Object({
    scope: skillScope,
    sourceDir: nonBlankString,
    overwrite: t.Optional(t.Boolean()),
    workspaceId: t.Optional(t.Nullable(nonBlankString)),
    agentId: t.Optional(t.Nullable(nonBlankString)),
  }),

  exportBody: t.Object({
    scope: skillScope,
    name: nonBlankString,
    destinationDir: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
    overwrite: t.Optional(t.Boolean()),
    workspaceId: t.Optional(t.Nullable(nonBlankString)),
    agentId: t.Optional(t.Nullable(nonBlankString)),
  }),

  exportResponse: t.Object({
    destinationDir: t.String(),
    ownerBoundary: exportOwnerBoundary,
  }),

  fetchSourceBody: t.Object({
    source: nonBlankString,
  }),

  importFromFetchBody: t.Object({
    sessionId: nonBlankString,
    selectedDirs: t.Array(nonBlankString, { minItems: 1 }),
    scope: skillScope,
    overwrite: t.Optional(t.Boolean()),
    workspaceId: t.Optional(t.Nullable(nonBlankString)),
    agentId: t.Optional(t.Nullable(nonBlankString)),
  }),

  cancelFetchBody: t.Object({
    sessionId: nonBlankString,
  }),
} as const
