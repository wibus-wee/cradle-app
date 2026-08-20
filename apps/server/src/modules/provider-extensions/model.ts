import { t } from 'elysia'

const providerKind = t.Union([
  t.Literal('openai-compatible'),
  t.Literal('anthropic'),
  t.Literal('universal'),
])

const status = t.Union([
  t.Literal('disabled'),
  t.Literal('enabling'),
  t.Literal('enabled'),
  t.Literal('disabling'),
  t.Literal('suspended'),
  t.Literal('error'),
])

const nullableString = t.Union([t.String(), t.Null()])

export const ProviderExtensionsModel = {
  params: t.Object({
    providerTargetId: t.String({ minLength: 1 }),
  }),
  setEnabledBody: t.Object({
    owner: t.String({ minLength: 1 }),
    id: t.String({ minLength: 1 }),
    enabled: t.Boolean(),
  }, { additionalProperties: false }),
  binding: t.Object({
    id: t.String(),
    providerTargetId: t.String(),
    extensionOwner: t.String(),
    extensionId: t.String(),
    extensionKey: t.String(),
    label: t.String(),
    description: nullableString,
    applicable: t.Boolean(),
    unavailableReason: nullableString,
    desiredEnabled: t.Boolean(),
    status,
    credentialStrategy: t.Union([
      t.Literal('borrowed-static'),
      t.Literal('exclusive-refreshable'),
      t.Null(),
    ]),
    credentialOwner: t.Union([t.Literal('host'), t.Literal('extension')]),
    providerKinds: t.Array(providerKind),
    addedProviderKinds: t.Array(providerKind),
    lastError: nullableString,
    updatedAt: t.Number(),
  }, { additionalProperties: false }),
}
