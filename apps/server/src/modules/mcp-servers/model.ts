import { t } from 'elysia'

const name = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
})
const secretValues = t.Record(t.String({ minLength: 1 }), t.String())

const stdioBody = t.Object({
  transport: t.Literal('stdio'),
  name,
  enabled: t.Boolean({ default: true }),
  command: t.String({ minLength: 1 }),
  args: t.Array(t.String()),
  secretValues: t.Optional(secretValues),
})

const streamableHttpBody = t.Object({
  transport: t.Literal('streamable-http'),
  name,
  enabled: t.Boolean({ default: true }),
  url: t.String({ minLength: 1, format: 'uri' }),
  secretValues: t.Optional(secretValues),
})

const registryInstallHint = t.Union([
  t.Object({
    transport: t.Literal('stdio'),
    command: t.String(),
    args: t.Array(t.String()),
  }),
  t.Object({
    transport: t.Literal('streamable-http'),
    url: t.String(),
  }),
])

export const McpServersModel = {
  idParams: t.Object({ id: t.String({ minLength: 1 }) }),
  registryQuery: t.Object({
    search: t.Optional(t.String()),
    cursor: t.Optional(t.String()),
  }),
  registryPage: t.Object({
    servers: t.Array(t.Object({
      name: t.String(),
      title: t.Union([t.String(), t.Null()]),
      description: t.Union([t.String(), t.Null()]),
      version: t.Union([t.String(), t.Null()]),
      publishedAt: t.Union([t.String(), t.Null()]),
      packageRegistry: t.Union([t.Literal('npm'), t.Literal('pypi'), t.Literal('oci'), t.Null()]),
      env: t.Array(t.Object({
        name: t.String(),
        description: t.Union([t.String(), t.Null()]),
        required: t.Boolean(),
      })),
      installHint: t.Union([registryInstallHint, t.Null()]),
    })),
    nextCursor: t.Union([t.String(), t.Null()]),
  }),
  saveBody: t.Union([stdioBody, streamableHttpBody]),
  enabledBody: t.Object({ enabled: t.Boolean() }),
  summary: t.Object({
    id: t.String(),
    name,
    transport: t.Union([t.Literal('stdio'), t.Literal('streamable-http')]),
    enabled: t.Boolean(),
    command: t.Optional(t.String()),
    args: t.Optional(t.Array(t.String())),
    url: t.Optional(t.String()),
    secretKeys: t.Array(t.String()),
    status: t.Union([t.Literal('ready'), t.Literal('disabled'), t.Literal('error')]),
    error: t.Optional(t.String()),
    supportedRuntimes: t.Array(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),
}
