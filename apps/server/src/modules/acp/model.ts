import { t } from 'elysia'

const authMethod = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.Optional(t.String()),
  kind: t.Union([
    t.Literal('agent'),
    t.Literal('env_var'),
    t.Literal('terminal'),
  ]),
  status: t.Union([
    t.Literal('supported'),
    t.Literal('unsupported'),
  ]),
  unavailableReason: t.Optional(t.String()),
  link: t.Optional(t.String()),
  fields: t.Optional(t.Array(t.Object({
    name: t.String(),
    label: t.Optional(t.String()),
    secret: t.Boolean(),
    optional: t.Boolean(),
  }))),
})

export const AcpModel = {
  registryAgent: t.Object({
    id: t.String(),
    name: t.String(),
    version: t.String(),
    description: t.Nullable(t.String()),
    repository: t.Optional(t.Nullable(t.String())),
    website: t.Optional(t.Nullable(t.String())),
    authors: t.Optional(t.Array(t.String())),
    license: t.Optional(t.Nullable(t.String())),
    icon: t.Optional(t.Nullable(t.String())),
    distribution: t.Object({
      binary: t.Optional(t.Any()),
      npx: t.Optional(t.Any()),
      uvx: t.Optional(t.Any()),
    }),
  }),

  acpAgent: t.Object({
    id: t.String(),
    name: t.String(),
    version: t.Nullable(t.String()),
    source: t.String(),
    distributionType: t.String(),
    installPath: t.Nullable(t.String()),
    cmd: t.Nullable(t.String()),
    args: t.Nullable(t.String()),
    env: t.Nullable(t.String()),
    overrideCmd: t.Nullable(t.String()),
    overrideArgs: t.Nullable(t.String()),
    overrideEnv: t.Nullable(t.String()),
    authMethodId: t.Nullable(t.String()),
    status: t.String(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  acpAuditEntry: t.Object({
    id: t.Number(),
    agentId: t.String(),
    action: t.String(),
    path: t.Nullable(t.String()),
    details: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  distributionTypesResult: t.Object({
    agentId: t.String(),
    types: t.Array(t.String()),
  }),

  draftSessionBody: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
  }),

  draftSessionResult: t.Object({
    sessionId: t.String(),
    selectedModelId: t.Nullable(t.String()),
    models: t.Array(t.Object({
      id: t.String(),
      label: t.String(),
    })),
  }),

  authMethod,

  authMethodsResult: t.Object({
    methods: t.Array(authMethod),
    selectedMethodId: t.Nullable(t.String()),
  }),

  authSelectionBody: t.Object({
    methodId: t.String({ minLength: 1 }),
    secretRefs: t.Optional(t.Record(
      t.String({ minLength: 1 }),
      t.String({ minLength: 1 }),
    )),
  }),

  authSelectionResult: t.Object({
    selectedMethodId: t.Nullable(t.String()),
  }),

  installBody: t.Object({
    distributionType: t.Union([
      t.Literal('binary'),
      t.Literal('npx'),
      t.Literal('uvx'),
    ]),
  }),

  createLocalAgentBody: t.Object({
    id: t.Optional(t.String({ minLength: 1 })),
    name: t.String({ minLength: 1 }),
    cmd: t.String({ minLength: 1 }),
    args: t.Optional(t.Array(t.String())),
    env: t.Optional(t.Record(t.String(), t.String())),
    distributionType: t.Optional(t.Union([
      t.Literal('command'),
      t.Literal('npx'),
      t.Literal('uvx'),
    ])),
    version: t.Optional(t.String({ minLength: 1 })),
  }),

  launchConfigBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    // registry overrides (null clears)
    overrideCmd: t.Optional(t.Union([t.String(), t.Null()])),
    overrideArgs: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
    overrideEnv: t.Optional(t.Union([t.Record(t.String(), t.String()), t.Null()])),
    // local base fields
    cmd: t.Optional(t.String({ minLength: 1 })),
    args: t.Optional(t.Array(t.String())),
    env: t.Optional(t.Record(t.String(), t.String())),
    distributionType: t.Optional(t.Union([
      t.Literal('command'),
      t.Literal('npx'),
      t.Literal('uvx'),
    ])),
    version: t.Optional(t.String({ minLength: 1 })),
  }),

  agentIdParams: t.Object({
    agentId: t.String({ minLength: 1 }),
  }),

  auditQuery: t.Object({
    agentId: t.Optional(t.String()),
  }),
}
