import { t } from 'elysia'

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
    distributionType: t.String(),
    installPath: t.Nullable(t.String()),
    cmd: t.Nullable(t.String()),
    args: t.Nullable(t.String()),
    env: t.Nullable(t.String()),
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

  installBody: t.Object({
    distributionType: t.Union([
      t.Literal('binary'),
      t.Literal('npx'),
      t.Literal('uvx'),
    ]),
  }),

  agentIdParams: t.Object({
    agentId: t.String({ minLength: 1 }),
  }),

  auditQuery: t.Object({
    agentId: t.Optional(t.String()),
  }),
}
