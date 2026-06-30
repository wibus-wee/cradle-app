import { t } from 'elysia'

import { modelCapabilitiesSchema, providerKindSchema } from '../provider-contracts/model'

const nullableString = t.Union([t.String(), t.Null()])
const nullableProfileRef = t.Union([t.String({ minLength: 1 }), t.Null()])

export const ProfilesModel = {
  agentProfile: t.Object({
    id: t.String(),
    name: t.String(),
    providerKind: providerKindSchema,
    enabled: t.Boolean(),
    configJson: t.String(),
    credentialRef: nullableString,
    customModels: t.String(),
    iconSlug: nullableString,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  upsertBody: t.Object({
    name: t.String({ minLength: 1 }),
    providerKind: providerKindSchema,
    enabled: t.Boolean(),
    config: t.Record(t.String(), t.Any()),
    credentialRef: t.Optional(nullableProfileRef),
    iconSlug: t.Optional(nullableString),
  }),

  customModelsBody: t.Object({
    models: t.Array(t.Object({
      id: t.String({ minLength: 1 }),
      label: t.Optional(t.String()),
      capabilities: t.Optional(modelCapabilitiesSchema),
    })),
  }),

  customModelEntry: t.Object({
    id: t.String(),
    label: t.String(),
    capabilities: modelCapabilitiesSchema,
  }),

}
