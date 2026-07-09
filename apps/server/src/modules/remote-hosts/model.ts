import { t } from 'elysia'

const nullableString = t.Union([t.String(), t.Null()])
const nullableNumber = t.Union([t.Number(), t.Null()])
const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })
const remoteHostTransport = t.Union([
  t.Literal('ssh'),
  t.Literal('direct-url'),
  t.Literal('relay'),
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

const relayConfig = t.Object({
  relayServerId: t.Optional(nullableString),
  relayUrl: t.Optional(nullableString),
  roomId: t.Optional(nullableString),
  pinnedHostPubkey: t.Optional(nullableString),
  controllerKeyRef: t.Optional(nullableString),
}, { additionalProperties: false })

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
  relay: t.Optional(relayConfig),
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

export const RemoteHostsModel = {
  hostIdParams: t.Object({
    hostId: t.String({ minLength: 1 }),
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

  ok: t.Object({
    ok: t.Literal(true),
  }, { additionalProperties: false }),

  relayClaimBody: t.Object({
    pairingString: nonBlankString,
  }, { additionalProperties: false }),
} as const
