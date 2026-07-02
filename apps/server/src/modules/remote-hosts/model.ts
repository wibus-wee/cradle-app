import { t } from 'elysia'

const nullableString = t.Union([t.String(), t.Null()])
const nullableNumber = t.Union([t.Number(), t.Null()])
const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })
const remoteHostTransport = t.Union([
  t.Literal('ssh'),
  t.Literal('direct-url'),
])
const sshAuth = t.Union([
  t.Literal('default'),
  t.Literal('identityFile'),
])
const cradleServerConnectionState = t.Union([
  t.Literal('idle'),
  t.Literal('connected'),
  t.Literal('offline'),
])

const sshProfile = t.Object({
  hostName: nonBlankString,
  user: t.Optional(nullableString),
  port: t.Optional(t.Union([t.Integer({ minimum: 1, maximum: 65_535 }), t.Null()])),
  auth: t.Optional(sshAuth),
  identityFilePath: t.Optional(nullableString),
}, { additionalProperties: false })

const connectionConfig = t.Object({
  transport: t.Optional(remoteHostTransport),
  baseUrl: t.Optional(nonBlankString),
  ssh: t.Optional(sshProfile),
  sshExecutable: t.Optional(nonBlankString),
  sshArgs: t.Optional(t.Array(t.String())),
  connectTimeoutMs: t.Optional(t.Integer({ minimum: 1, maximum: 120_000 })),
}, { additionalProperties: false })

const cradleServerCapability = t.Object({
  enabled: t.Optional(t.Boolean()),
  remoteHost: t.Optional(nonBlankString),
  remotePort: t.Optional(t.Integer({ minimum: 1, maximum: 65_535 })),
}, { additionalProperties: false })

const capabilities = t.Object({
  cradleServer: t.Optional(cradleServerCapability),
}, { additionalProperties: false })

const cradleServerHealthPayload = t.Object({
  status: t.Literal('ok'),
  uptime: t.Number(),
  memory: t.Object({
    heapUsed: t.Number(),
    heapTotal: t.Number(),
    rss: t.Number(),
    external: t.Number(),
  }, { additionalProperties: false }),
  cpu: t.Object({
    percent: t.Union([t.Number(), t.Null()]),
    userMicros: t.Number(),
    systemMicros: t.Number(),
    sampleMs: t.Union([t.Number(), t.Null()]),
    usedMicros: t.Union([t.Number(), t.Null()]),
    windowReady: t.Boolean(),
  }, { additionalProperties: false }),
  timestamp: t.Number(),
}, { additionalProperties: false })

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

const workspaceFileEntry = t.Object({
  type: t.Union([t.Literal('file'), t.Literal('directory')]),
  name: t.String(),
  path: t.String(),
}, { additionalProperties: false })

export const RemoteHostsModel = {
  hostIdParams: t.Object({
    hostId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  remoteWorkspaceIdParams: t.Object({
    hostId: t.String({ minLength: 1 }),
    remoteWorkspaceId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  host: t.Object({
    id: t.String(),
    displayName: t.String(),
    enabled: t.Boolean(),
    lastSeenAt: nullableNumber,
    connectionConfigJson: t.String(),
    capabilitiesJson: t.String(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    connectionState: cradleServerConnectionState,
    lastError: nullableString,
  }, { additionalProperties: false }),

  createHostBody: t.Object({
    id: t.Optional(nonBlankString),
    displayName: nonBlankString,
    enabled: t.Optional(t.Boolean()),
    connectionConfig: t.Optional(connectionConfig),
    capabilities: t.Optional(capabilities),
  }, { additionalProperties: false }),

  updateHostBody: t.Object({
    displayName: t.Optional(nonBlankString),
    enabled: t.Optional(t.Boolean()),
    connectionConfig: t.Optional(connectionConfig),
    capabilities: t.Optional(capabilities),
  }, { additionalProperties: false }),

  cradleServerConnection: t.Object({
    hostId: t.String(),
    state: cradleServerConnectionState,
    localBaseUrl: nullableString,
    lastError: nullableString,
  }, { additionalProperties: false }),

  cradleServerHealth: t.Object({
    hostId: t.String(),
    state: cradleServerConnectionState,
    localBaseUrl: nullableString,
    lastError: nullableString,
    status: t.Literal('ok'),
    health: cradleServerHealthPayload,
  }, { additionalProperties: false }),

  remoteWorkspaceList: t.Object({
    workspaces: t.Array(workspaceRecord),
  }, { additionalProperties: false }),

  fileChildrenQuery: t.Object({
    path: t.Optional(t.String()),
  }, { additionalProperties: false }),

  fileContentQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  fileInfoQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  workspaceFileList: t.Object({
    files: t.Array(workspaceFileEntry),
  }, { additionalProperties: false }),

  readFileResponse: t.Object({
    content: nullableString,
  }, { additionalProperties: false }),

  fileInfoResponse: t.Union([
    t.Object({
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
    t.Null(),
  ]),

  ok: t.Object({
    ok: t.Literal(true),
  }, { additionalProperties: false }),
} as const
