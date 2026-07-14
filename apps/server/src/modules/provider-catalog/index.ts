import { Elysia, t } from 'elysia'

import { enrichModelsFromRegistryMappings, lookupModel, searchModels } from '../model-registry/model-info-registry'
import * as ModelRegistry from '../model-registry/service'
import { resolveProviderTarget } from '../provider-targets/service'
import { ProvidersModel } from './model'
import {
  getCachedModelRefreshFailure,
  getCachedModelsForTarget,
  isCacheStale,
  setCachedModelRefreshFailure,
  setCachedModelsForTarget,
} from './model-cache'
import { projectProviderModelListCapabilities } from './model-capabilities'
import * as Providers from './service'

export const providers = new Elysia({
  prefix: '/providers',
  detail: { tags: ['providers'] },
})
  .post(
    '/models',
    async ({ body }) => {
      const request = Providers.ProviderRequestSchema.parse(body)
      const target = request.providerTargetId
        ? {
            ...(request.providerTargetKind ? { kind: request.providerTargetKind } : {}),
            id: request.providerTargetId,
          }
        : request.profileId
          ? { kind: 'manual' as const, id: request.profileId }
          : null
      try {
        // Collect raw inventory first so we can cache it before enriching.
        const inventory = await Providers.collectProviderModelInventory(request)
        if (target) {
          setCachedModelsForTarget(target, inventory)
        }
        const enriched = await enrichModelsFromRegistryMappings(inventory, ModelRegistry.listMappingEntries())
        return projectProviderModelListCapabilities(enriched)
      }
      catch (error) {
        if (target) {
          setCachedModelRefreshFailure(target)
        }
        throw error
      }
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
      const [cached, failure] = await Promise.all([
        getCachedModelsForTarget(target),
        getCachedModelRefreshFailure(target),
      ])
      if (!cached) {
        return { models: [], cached: false, stale: false, coolingDown: failure !== null, providerLabel: '' }
      }
      const resolved = resolveProviderTarget(target)
      return {
        models: cached.models,
        cached: true,
        stale: isCacheStale(cached.fetchedAt),
        coolingDown: failure !== null,
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
          coolingDown: t.Boolean(),
          providerLabel: t.String(),
        }),
      },
    },
  )
  .get(
    '/:profileId/models-cache',
    async ({ params }) => {
      const target = { kind: 'manual' as const, id: params.profileId }
      const [cached, failure] = await Promise.all([
        getCachedModelsForTarget(target),
        getCachedModelRefreshFailure(target),
      ])
      if (!cached) {
        return { models: [], cached: false, stale: false, coolingDown: failure !== null }
      }
      return {
        models: cached.models,
        cached: true,
        stale: isCacheStale(cached.fetchedAt),
        coolingDown: failure !== null,
      }
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
          coolingDown: t.Boolean(),
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
