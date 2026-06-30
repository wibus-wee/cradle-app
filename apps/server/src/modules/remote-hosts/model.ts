import { t } from 'elysia'

const nullableString = t.Union([t.String(), t.Null()])
const nullableNumber = t.Union([t.Number(), t.Null()])
const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })
const remoteHostTransport = t.Union([
  t.Literal('ssh'),
  t.Literal('direct-socket'),
  t.Literal('relay'),
])
const sshAuth = t.Union([
  t.Literal('default'),
  t.Literal('identityFile'),
])
const connectionState = t.Union([
  t.Literal('idle'),
  t.Literal('connecting'),
  t.Literal('connected'),
  t.Literal('disconnected'),
  t.Literal('offline'),
])

const sshProfile = t.Object({
  hostName: nonBlankString,
  user: t.Optional(nullableString),
  port: t.Optional(t.Union([t.Integer({ minimum: 1, maximum: 65_535 }), t.Null()])),
  auth: t.Optional(sshAuth),
  identityFilePath: t.Optional(nullableString),
}, { additionalProperties: false })

const relayConfig = t.Object({
  relayUrl: nonBlankString,
  enrollmentId: t.Optional(nonBlankString),
  relayServerId: t.Optional(nullableString),
  enrollmentSecretHash: t.Optional(nonBlankString),
  lastSessionRoomId: t.Optional(nonBlankString),
  lastSeenAt: t.Optional(t.Integer({ minimum: 0 })),
}, { additionalProperties: false })

const connectionConfig = t.Object({
  transport: t.Optional(remoteHostTransport),
  localSocketPath: t.Optional(nonBlankString),
  ssh: t.Optional(sshProfile),
  relay: t.Optional(relayConfig),
  sshExecutable: t.Optional(nonBlankString),
  sshArgs: t.Optional(t.Array(t.String())),
  connectTimeoutMs: t.Optional(t.Integer({ minimum: 1, maximum: 120_000 })),
}, { additionalProperties: false })

const agentdCapability = t.Object({
  enabled: t.Optional(t.Boolean()),
  remoteSocketPath: t.Optional(nonBlankString),
  lastDaemonHostId: t.Optional(nullableString),
  lastDaemonVersion: t.Optional(nullableString),
  lastPlatform: t.Optional(nullableString),
  lastArch: t.Optional(nullableString),
}, { additionalProperties: false })

const cradleServerCapability = t.Object({
  enabled: t.Optional(t.Boolean()),
  remoteHost: t.Optional(nonBlankString),
  remotePort: t.Optional(t.Integer({ minimum: 1, maximum: 65_535 })),
}, { additionalProperties: false })

const capabilities = t.Object({
  agentd: t.Optional(agentdCapability),
  cradleServer: t.Optional(cradleServerCapability),
}, { additionalProperties: false })

const cradleServerConnectionState = t.Union([
  t.Literal('idle'),
  t.Literal('connected'),
  t.Literal('offline'),
])

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

const runtimeSummary = t.Object({
  runtimeKind: t.String(),
  label: t.String(),
  status: t.Union([t.Literal('available'), t.Literal('unavailable')]),
  detail: nullableString,
}, { additionalProperties: false })

const fsEntryKind = t.Union([
  t.Literal('file'),
  t.Literal('directory'),
  t.Literal('symlink'),
  t.Literal('other'),
])

const fsEntry = t.Object({
  name: t.String(),
  path: t.String(),
  kind: fsEntryKind,
  size: nullableNumber,
  modifiedAt: nullableNumber,
  hidden: t.Boolean(),
}, { additionalProperties: false })

const workspaceSummary = t.Object({
  id: t.String(),
  name: t.String(),
  path: t.String(),
  reason: t.String(),
}, { additionalProperties: false })

const agentSummary = t.Object({
  agentId: t.String(),
  runtimeKind: t.String(),
  workspacePath: t.String(),
  status: t.Union([t.Literal('idle'), t.Literal('running'), t.Literal('failed')]),
  providerSessionId: nullableString,
  createdAt: t.Number(),
  updatedAt: t.Number(),
}, { additionalProperties: false })

export const RemoteHostsModel = {
  hostIdParams: t.Object({
    hostId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  relayEnrollmentIdParams: t.Object({
    enrollmentId: t.String({ minLength: 1 }),
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
    connectionState,
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

  connection: t.Object({
    hostId: t.String(),
    state: connectionState,
    localSocketPath: nullableString,
    daemonHostId: nullableString,
    daemonVersion: nullableString,
    platform: nullableString,
    arch: nullableString,
    lastError: nullableString,
  }, { additionalProperties: false }),

  health: t.Object({
    hostId: t.String(),
    status: t.Union([t.Literal('ok'), t.Literal('offline')]),
    daemonVersion: nullableString,
    daemonHostId: nullableString,
    uptimeSeconds: nullableNumber,
    connectionState,
    lastError: nullableString,
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

  runtimeList: t.Object({
    runtimes: t.Array(runtimeSummary),
  }, { additionalProperties: false }),

  workspaceQuery: t.Object({
    root: t.Optional(t.String()),
  }, { additionalProperties: false }),

  fsPathQuery: t.Object({
    path: t.Optional(t.String()),
  }, { additionalProperties: false }),

  requiredFsPathQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  workspaceList: t.Object({
    workspaces: t.Array(workspaceSummary),
    message: nullableString,
  }, { additionalProperties: false }),

  fsDirectoryList: t.Object({
    path: t.String(),
    parentPath: nullableString,
    entries: t.Array(fsEntry),
  }, { additionalProperties: false }),

  fsStat: fsEntry,

  gitRepositoryProbe: t.Object({
    path: t.String(),
    isRepository: t.Boolean(),
    rootPath: nullableString,
    branch: nullableString,
    remoteUrl: nullableString,
  }, { additionalProperties: false }),

  agentList: t.Object({
    agents: t.Array(agentSummary),
  }, { additionalProperties: false }),

  startAgentBody: t.Object({
    runtimeKind: nonBlankString,
    workspacePath: nonBlankString,
    chatSessionId: t.Optional(nullableString),
    providerSessionId: t.Optional(nullableString),
    modelId: t.Optional(nullableString),
  }, { additionalProperties: false }),

  startAgentResponse: t.Object({
    agent: agentSummary,
  }, { additionalProperties: false }),

  relayPairingTokenBody: t.Object({
    relayUrl: t.Optional(nonBlankString),
    relayServerId: t.Optional(nonBlankString),
    ttlMs: t.Optional(t.Integer({ minimum: 1_000, maximum: 3_600_000 })),
  }, { additionalProperties: false }),

  relayPairingTokenResponse: t.Object({
    relayUrl: t.String(),
    relayServerId: nullableString,
    roomId: t.String(),
    pairingToken: t.String(),
    hostToken: t.String(),
    enrollmentId: t.String(),
    enrollmentSecret: t.String(),
    expiresAt: t.String(),
  }, { additionalProperties: false }),

  relayClaimBody: t.Object({
    relayUrl: t.Optional(nonBlankString),
    relayServerId: t.Optional(nonBlankString),
    pairingCode: nonBlankString,
    ttlMs: t.Optional(t.Integer({ minimum: 1_000, maximum: 3_600_000 })),
  }, { additionalProperties: false }),

  relayClaimResponse: t.Object({
    relayUrl: t.String(),
    roomId: t.String(),
    enrollmentId: t.String(),
  }, { additionalProperties: false }),

  relayHostSessionBody: t.Object({
    enrollmentSecret: nonBlankString,
    ttlMs: t.Optional(t.Integer({ minimum: 1_000, maximum: 3_600_000 })),
  }, { additionalProperties: false }),

  relayHostSessionResponse: t.Object({
    relayUrl: t.String(),
    roomId: t.String(),
    roomStartToken: t.String(),
    hostToken: t.String(),
    expiresAt: t.String(),
  }, { additionalProperties: false }),

  ok: t.Object({
    ok: t.Literal(true),
  }, { additionalProperties: false }),
} as const
