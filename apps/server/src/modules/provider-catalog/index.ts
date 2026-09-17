import { Elysia, t } from 'elysia'

import { lookupModel, searchModels } from '../model-registry/model-info-registry'
import { ProvidersModel } from './model'
import { collectProviderPresets } from './provider-presets'
import * as Providers from './service'
import { queryProviderTargetModels } from './target-model-query'

export const providerPresets = new Elysia({
  detail: { tags: ['providers'] },
})
  .get(
    '/provider-presets',
    async () => await collectProviderPresets(),
    {
      detail: {
        'summary': 'List provider presets',
        'x-cradle-cli': {
          command: ['provider', 'presets'],
        },
      },
      response: { 200: t.Array(ProvidersModel.providerPreset) },
    },
  )

export const providers = new Elysia({
  prefix: '/providers',
  detail: { tags: ['providers'] },
})
  .post(
    '/models',
    async ({ body }) => {
      const request = Providers.ProviderRequestSchema.parse(body)
      const target = Providers.requestedProviderTarget(request)
      // An explicit POST is a user-driven refresh: unconditional live fetch that
      // bypasses the failed-refresh cooldown, with cache persistence owned by
      // the target query pipeline.
      const result = target
        ? await queryProviderTargetModels({ target, freshness: 'refresh', workspaceId: request.workspaceId })
        : { models: await Providers.listModels(request) }
      return result.models
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
      const result = await queryProviderTargetModels({
        target: { id: params.providerTargetId },
        freshness: 'cached',
      })
      return {
        models: result.models,
        cached: result.cached,
        stale: result.stale,
        coolingDown: result.coolingDown,
        providerLabel: result.providerLabel,
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
      const result = await queryProviderTargetModels({
        target: { kind: 'manual', id: params.profileId },
        freshness: 'cached',
      })
      return {
        models: result.models,
        cached: result.cached,
        stale: result.stale,
        coolingDown: result.coolingDown,
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
