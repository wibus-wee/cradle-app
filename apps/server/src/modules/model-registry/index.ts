import { Elysia, t } from 'elysia'

import { ModelRegistryModel } from './model'
import * as ModelRegistry from './service'

export const modelRegistry = new Elysia({
  prefix: '/model-registry',
  detail: { tags: ['model-registry'] },
})
  .get(
    '/mappings',
    () => ModelRegistry.listMappings(),
    {
      detail: {
        summary: 'List global model registry mappings',
      },
      response: { 200: t.Array(ModelRegistryModel.mapping) },
    },
  )
  .put(
    '/mappings/:modelId',
    async ({ params, body }) =>
      ModelRegistry.upsertMapping({
        ...body,
        modelId: params.modelId,
      }),
    {
      detail: {
        summary: 'Create or update a global model registry mapping',
      },
      params: ModelRegistryModel.modelIdParams,
      body: ModelRegistryModel.mappingBody,
      response: { 200: ModelRegistryModel.mapping },
    },
  )
  .delete(
    '/mappings/:modelId',
    ({ params }) => {
      ModelRegistry.deleteMapping(params.modelId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Delete a global model registry mapping',
      },
      params: ModelRegistryModel.modelIdParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    },
  )
