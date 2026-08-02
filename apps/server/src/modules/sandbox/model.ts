import { t } from 'elysia'

const nullableString = t.Nullable(t.String())
const nullableNumber = t.Nullable(t.Number())

const mount = t.Object({
  hostPath: t.String(),
  containerPath: t.String(),
  readOnly: t.Boolean(),
})

const profile = t.Object({
  id: t.String(),
  name: t.String(),
  image: t.String(),
  workdir: t.String(),
  env: t.Record(t.String(), t.String()),
  cpuLimit: t.Optional(t.Number()),
  memoryMb: t.Optional(t.Number()),
  networkMode: t.Union([t.Literal('none'), t.Literal('bridge')]),
  idleTtlSec: t.Number(),
  labels: t.Record(t.String(), t.String()),
})

const lease = t.Object({
  id: t.String(),
  instanceId: t.String(),
  profileId: t.String(),
  engineContainerId: t.String(),
  workId: nullableString,
  sessionId: nullableString,
  workspaceId: t.String(),
  purpose: t.String(),
  mountsResolved: t.Array(mount),
  createdAt: t.Number(),
  expiresAt: nullableNumber,
  releasedAt: nullableNumber,
})

const poolConfig = t.Object({
  minWarm: t.Number(),
  maxTotal: t.Number(),
  maxPerWork: t.Number(),
  defaultExecTimeoutMs: t.Number(),
  maxExecTimeoutMs: t.Number(),
})

const poolStatus = t.Object({
  runtimeKind: t.Union([t.Literal('mock'), t.Literal('docker-cli')]),
  engineAvailable: t.Boolean(),
  config: poolConfig,
  profiles: t.Array(t.Object({
    id: t.String(),
    name: t.String(),
    image: t.String(),
    warm: t.Number(),
    leased: t.Number(),
  })),
  totals: t.Object({
    warm: t.Number(),
    leased: t.Number(),
    stopping: t.Number(),
    dead: t.Number(),
    activeLeases: t.Number(),
  }),
})

const execResult = t.Object({
  leaseId: t.String(),
  exitCode: t.Number(),
  stdout: t.String(),
  stderr: t.String(),
  timedOut: t.Boolean(),
})

const reconcileResult = t.Object({
  expiredReleased: t.Number(),
  orphansRemoved: t.Number(),
  warmEnsured: t.Number(),
})

export const SandboxModel = {
  profile,
  lease,
  poolStatus,
  execResult,
  reconcileResult,

  leaseBody: t.Object({
    profileId: t.String({ minLength: 1 }),
    workspaceId: t.String({ minLength: 1 }),
    workId: t.Optional(t.String({ minLength: 1 })),
    sessionId: t.Optional(t.String({ minLength: 1 })),
    purpose: t.Optional(t.String()),
    mountPath: t.Optional(t.String({ minLength: 1 })),
    mountWritable: t.Optional(t.Boolean()),
    networkMode: t.Optional(t.Union([t.Literal('none'), t.Literal('bridge')])),
    ttlSec: t.Optional(t.Number()),
  }),

  listLeasesQuery: t.Object({
    workId: t.Optional(t.String({ minLength: 1 })),
    sessionId: t.Optional(t.String({ minLength: 1 })),
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    includeReleased: t.Optional(t.Boolean()),
  }),

  leaseIdParams: t.Object({
    leaseId: t.String({ minLength: 1 }),
  }),

  execBody: t.Object({
    command: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
    workdir: t.Optional(t.String({ minLength: 1 })),
    env: t.Optional(t.Record(t.String(), t.String())),
    timeoutMs: t.Optional(t.Number()),
  }),
}
