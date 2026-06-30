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
}
