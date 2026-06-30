import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })

export const RelayServersModel = {
  relayServer: t.Object({
    id: t.String(),
    displayName: t.String(),
    relayUrl: t.String(),
    enabled: t.Boolean(),
    isDefault: t.Boolean(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }, { additionalProperties: false }),

  relayServerIdParams: t.Object({
    relayServerId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  createRelayServerBody: t.Object({
    id: t.Optional(nonBlankString),
    displayName: nonBlankString,
    relayUrl: nonBlankString,
    enabled: t.Optional(t.Boolean()),
    isDefault: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),

  updateRelayServerBody: t.Object({
    displayName: t.Optional(nonBlankString),
    relayUrl: t.Optional(nonBlankString),
    enabled: t.Optional(t.Boolean()),
    isDefault: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),

  ok: t.Object({
    ok: t.Literal(true),
  }, { additionalProperties: false }),
} as const
