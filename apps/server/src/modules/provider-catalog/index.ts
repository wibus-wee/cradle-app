import { Elysia, t } from 'elysia'

import { lookupModel, searchModels } from '../model-registry/model-info-registry'
import { resolveProviderTarget } from '../provider-targets/service'
import { ProvidersModel } from './model'
import {
  getCachedModelsForTarget,
  isCacheStale,
  setCachedModelsForTarget,
} from './model-cache'
import * as Providers from './service'

export const providers = new Elysia({
  prefix: '/providers',
  detail: { tags: ['providers'] },
})
  .post(
    '/models',
    async ({ body }) => {
      const request = Providers.ProviderRequestSchema.parse(body)
      const models = await Providers.listModels(request)
      if (request.providerTargetId) {
        setCachedModelsForTarget(
          {
            ...(request.providerTargetKind ? { kind: request.providerTargetKind } : {}),
            id: request.providerTargetId,
          },
          models,
        )
      }
      else if (request.profileId) {
        setCachedModelsForTarget({ kind: 'manual', id: request.profileId }, models)
      }
      return models
    },
    {
      detail: {
        'summary': 'List models for a provider',
        'x-cradle-cli': {
          command: ['provider', 'models'],
        },
      },
      body: ProvidersModel.providerBody,
      response: { 200: t.Array(ProvidersModel.modelDescriptor) },
    },
  )
  .get(
    '/targets/:providerTargetId/models-cache',
    async ({ params }) => {
      const target = { id: params.providerTargetId }
      const cached = getCachedModelsForTarget(target)
      if (!cached) {
        return { models: [], cached: false, stale: false, providerLabel: '' }
      }
      const resolved = resolveProviderTarget(target)
      return {
        models: cached.models,
        cached: true,
        stale: isCacheStale(cached.fetchedAt),
        providerLabel: resolved.label,
      }
    },
    {
      detail: {
        summary: 'Get cached models for a provider target',
      },
      params: t.Object({
        providerTargetId: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({
          models: t.Array(ProvidersModel.modelDescriptor),
          cached: t.Boolean(),
          stale: t.Boolean(),
          providerLabel: t.String(),
        }),
      },
    },
  )
  .get(
    '/:profileId/models-cache',
    async ({ params }) => {
      const cached = getCachedModelsForTarget({ kind: 'manual', id: params.profileId })
      if (!cached) {
        return { models: [], cached: false, stale: false }
      }
      return { models: cached.models, cached: true, stale: isCacheStale(cached.fetchedAt) }
    },
    {
      detail: {
        summary: 'Get cached models for a provider profile',
      },
      params: t.Object({
        profileId: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({
          models: t.Array(ProvidersModel.modelDescriptor),
          cached: t.Boolean(),
          stale: t.Boolean(),
        }),
      },
    },
  )
  .post(
    '/model-lookup',
    async ({ body }) => {
      return (await lookupModel(body.modelId)) ?? null
    },
    {
      detail: {
        summary: 'Look up model metadata from registry',
      },
      body: t.Object({
        modelId: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Union([
          t.Object({
            id: t.String(),
            label: t.String(),
            capabilities: ProvidersModel.modelCapabilities,
          }),
          t.Null(),
        ]),
      },
    },
  )
  .post(
    '/model-search',
    async ({ body }) => {
      return await searchModels(body.query, 20)
    },
    {
      detail: {
        summary: 'Search models from models.dev registry',
      },
      body: t.Object({
        query: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Array(
          t.Object({
            id: t.String(),
            label: t.String(),
            capabilities: ProvidersModel.modelCapabilities,
          }),
        ),
      },
    },
  )
