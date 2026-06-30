import { t } from 'elysia'

const modelsDevModel = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.Optional(t.String()),
  limit: t.Optional(
    t.Object({
      context: t.Optional(t.Number()),
      output: t.Optional(t.Number()),
    }),
  ),
  modalities: t.Optional(
    t.Object({
      input: t.Optional(t.Array(t.String())),
      output: t.Optional(t.Array(t.String())),
    }),
  ),
  reasoning: t.Optional(t.Boolean()),
  tool_call: t.Optional(t.Boolean()),
  temperature: t.Optional(t.Boolean()),
  structured_output: t.Optional(t.Boolean()),
  cost: t.Optional(
    t.Object({
      input: t.Optional(t.Number()),
      output: t.Optional(t.Number()),
      cache_read: t.Optional(t.Number()),
      cache_write: t.Optional(t.Number()),
    }),
  ),
  family: t.Optional(t.String()),
  knowledge: t.Optional(t.String()),
  release_date: t.Optional(t.String()),
})

export const ModelRegistryModel = {
  mapping: t.Object({
    modelId: t.String(),
    registryModelId: t.String(),
    matchType: t.Union([t.Literal('manual'), t.Literal('alias')]),
    model: t.Optional(modelsDevModel),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  mappingBody: t.Object({
    registryModelId: t.Optional(t.String({ minLength: 1 })),
    matchType: t.Optional(t.Union([t.Literal('manual'), t.Literal('alias')])),
    model: t.Optional(modelsDevModel),
  }),

  modelIdParams: t.Object({
    modelId: t.String({ minLength: 1 }),
  }),
}
