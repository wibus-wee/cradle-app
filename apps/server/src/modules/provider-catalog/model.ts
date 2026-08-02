import { t } from 'elysia'

import {
  modelCapabilitiesSchema,
  modelDescriptorSchema,
  providerKindSchema,
} from '../provider-contracts/model'

const nullableRef = t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
const nullableTargetKind = t.Optional(
  t.Union([t.Literal('manual'), t.Literal('external'), t.Null()]),
)

export const ProvidersModel = {
  providerBody: t.Object({
    providerKind: providerKindSchema,
    label: t.String({ minLength: 1 }),
    config: t.Record(t.String(), t.Unknown()),
    secretRef: nullableRef,
    profileId: nullableRef,
    providerTargetKind: nullableTargetKind,
    providerTargetId: nullableRef,
    workspaceId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  }),

  modelDescriptor: modelDescriptorSchema,

  modelCapabilities: modelCapabilitiesSchema,

  providerPreset: t.Object({
    id: t.String(),
    name: t.String(),
    providerKind: providerKindSchema,
    baseUrl: t.String(),
    iconSlug: t.Optional(t.String()),
    docsUrl: t.Optional(t.String()),
    local: t.Boolean(),
    requiresApiKey: t.Boolean(),
    source: t.Union([t.Literal('models.dev'), t.Literal('overlay'), t.Literal('builtin')]),
    providerId: t.String(),
    tier: t.Union([t.Literal('first-class'), t.Literal('generic')]),
    featured: t.Optional(t.Boolean()),
    authMethods: t.Array(t.Object({
      id: t.String(),
      label: t.String(),
    })),
    endpointProfiles: t.Array(t.Object({
      id: t.String(),
      label: t.String(),
      wireKind: providerKindSchema,
      defaultBaseUrl: t.Optional(t.String()),
      optional: t.Optional(t.Boolean()),
    })),
    models: t.Array(t.Object({
      id: t.String(),
      name: t.Optional(t.String()),
      reasoning: t.Optional(t.Boolean()),
      toolCall: t.Optional(t.Boolean()),
      vision: t.Optional(t.Boolean()),
    })),
  }),
}
