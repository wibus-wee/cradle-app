import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })
const nullableString = t.Union([t.String(), t.Null()])

interface WorkspaceRecord {
  id: string
  name: string
  locator: {
    hostId: string
    path: string
    kind?: 'project' | 'managed-worktree'
    sourceWorkspaceId?: string | null
  }
  gitIdentity: {
    originUrl?: string | null
    repoRoot?: string | null
    headSha?: string | null
    branch?: string | null
  }
  identifier: string
  pinned: number
  createdAt: number
  updatedAt: number
}

const workspaceLocator = t.Object({
  hostId: nonBlankString,
  path: nonBlankString,
  kind: t.Optional(t.Union([t.Literal('project'), t.Literal('managed-worktree')])),
  sourceWorkspaceId: t.Optional(nullableString),
}, { additionalProperties: false })

const workspaceGitIdentity = t.Object({
  originUrl: t.Optional(nullableString),
  repoRoot: t.Optional(nullableString),
  headSha: t.Optional(nullableString),
  branch: t.Optional(nullableString),
}, { additionalProperties: false })

const ownerBoundary = t.Object({
  classification: t.Literal('non-cradle-owned'),
  owner: t.Literal('workspace'),
  consentRequired: t.Literal(true),
  consentConfirmed: t.Literal(true),
  workspacePath: nullableString,
  relativePath: t.String(),
  targetPath: nullableString,
}, { additionalProperties: false })

const workspaceRecord = t.Object({
  id: t.String(),
  name: t.String(),
  locator: workspaceLocator,
  gitIdentity: workspaceGitIdentity,
  identifier: t.String(),
  pinned: t.Number(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
}, { additionalProperties: false })

const nullableWorkspaceRecord = t.Union([workspaceRecord, t.Null()])

const inspectionFolder = t.Object({
  name: t.String(),
  path: t.String(),
}, { additionalProperties: false })

const inspectionConfig = t.Union([
  t.Object({
    name: t.String(),
    folders: t.Array(inspectionFolder),
  }, { additionalProperties: false }),
  t.Null(),
])

export const WorkspaceModel = {
  record: workspaceRecord,

  nullableRecord: nullableWorkspaceRecord,

  locator: workspaceLocator,

  gitIdentity: workspaceGitIdentity,

  fileEntry: t.Object({
    type: t.Union([t.Literal('file'), t.Literal('directory')]),
    name: t.String(),
    path: t.String(),
  }, { additionalProperties: false }),

  createBody: t.Object({
    name: nonBlankString,
    locator: workspaceLocator,
    gitIdentity: t.Optional(workspaceGitIdentity),
  }, { additionalProperties: false }),

  multiFolderWorkspaceFolder: t.Object({
    name: nonBlankString,
    path: nonBlankString,
  }, { additionalProperties: false }),

  multiFolderWorkspaceBody: t.Object({
    name: nonBlankString,
    folders: t.Array(t.Object({
      name: nonBlankString,
      path: nonBlankString,
    }, { additionalProperties: false }), { minItems: 1 }),
  }, { additionalProperties: false }),

  multiFolderWorkspaceImportBody: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  importBody: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  inspectionFolder,

  inspectionConfig,

  inspectBody: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  inspectionResult: t.Object({
    path: t.String(),
    cradleWorkspaceDetected: t.Boolean(),
    config: inspectionConfig,
    configValid: t.Boolean(),
    configError: nullableString,
    featureFlagEnabled: t.Boolean(),
    alreadyImported: t.Boolean(),
    recommendedAction: t.Union([t.Literal('multi-folder'), t.Literal('single-folder')]),
  }, { additionalProperties: false }),

  resolveQuery: t.Object({
    hostId: nonBlankString,
    path: nonBlankString,
  }, { additionalProperties: false }),

  updateBody: t.Object({
    name: t.Optional(nonBlankString),
    pinned: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  workspaceIdParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  fileContentQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  fileChildrenQuery: t.Object({
    path: t.Optional(t.String()),
  }, { additionalProperties: false }),

  fileSearchQuery: t.Object({
    q: t.Optional(t.String()),
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  }, { additionalProperties: false }),

  fileInfoQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  writeFileBody: t.Object({
    path: nonBlankString,
    content: t.String(),
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  createFileBody: t.Object({
    path: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  createFolderBody: t.Object({
    path: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  renameFileBody: t.Object({
    sourcePath: nonBlankString,
    destinationPath: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  readFileResponse: t.Object({
    content: nullableString,
  }),

  fileInfoResponse: t.Object({
    name: t.String(),
    path: t.String(),
    size: t.Number(),
    modifiedAt: t.Number(),
    mimeType: t.String(),
    extension: t.String(),
    previewKind: t.Union([
      t.Literal('text'),
      t.Literal('markdown'),
      t.Literal('image'),
      t.Literal('pdf'),
      t.Literal('office'),
      t.Literal('unsupported'),
    ]),
  }, { additionalProperties: false }),

  writeFileResponse: t.Object({
    success: t.Boolean(),
    ownerBoundary,
  }),

  fileOperationResponse: t.Object({
    success: t.Boolean(),
    ownerBoundary,
  }),

  renameFileResponse: t.Object({
    success: t.Boolean(),
    sourceBoundary: ownerBoundary,
    destinationBoundary: ownerBoundary,
  }),

  deleteResponse: t.Object({
    ok: t.Literal(true),
  }),

  locatorExistsError: t.Object({
    code: t.Literal('workspace_locator_exists'),
    message: t.String(),
    details: t.Object({ locator: workspaceLocator }),
  }),
} as const
