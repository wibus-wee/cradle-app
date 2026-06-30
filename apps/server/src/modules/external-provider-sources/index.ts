import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ExternalProviderSourcesModel } from './model'
import * as ExternalProviderSources from './service'

const nullableString = t.Union([t.String(), t.Null()])

export const externalProviderSources = new Elysia({
  detail: { tags: ['external-provider-sources'] },
})
  .get('/external-provider-sources', () => ExternalProviderSources.listExternalProviderSources(), {
    detail: {
      summary: 'List external provider sources',
    },
    response: { 200: t.Array(ExternalProviderSourcesModel.source) },
  })
  .post('/external-provider-sources/refresh', () => ExternalProviderSources.refreshAllExternalProviderSources(), {
    detail: {
      summary: 'Refresh all external provider sources',
    },
    response: { 200: t.Array(ExternalProviderSourcesModel.refreshResult) },
  })
  .post('/external-provider-sources/:sourceKey/refresh', ({ params }) => {
    return ExternalProviderSources.refreshExternalProviderSource(params.sourceKey)
  }, {
    detail: {
      summary: 'Refresh an external provider source',
    },
    params: ExternalProviderSourcesModel.refreshParams,
    response: { 200: ExternalProviderSourcesModel.refreshResult },
  })
  .get('/external-provider-sources/records', () => ExternalProviderSources.listExternalProviderRecords(), {
    detail: {
      summary: 'List external provider source records',
    },
    response: { 200: t.Array(ExternalProviderSourcesModel.record) },
  })
  .get('/external-provider-sources/:sourceKey/records/:externalRecordId/runtime-target', ({ params }) => {
    const target = ExternalProviderSources.getExternalRuntimeTarget(params.sourceKey, params.externalRecordId)
    if (!target) {
      throw new AppError({
        code: 'external_provider_target_not_found',
        status: 404,
        message: 'External provider target not found',
        details: {
          sourceKey: params.sourceKey,
          externalRecordId: params.externalRecordId,
        },
      })
    }
    return target
  }, {
    detail: {
      summary: 'Get runtime target metadata for an external provider record',
    },
    params: ExternalProviderSourcesModel.recordParams,
    response: {
      200: t.Object({
        id: t.String(),
        sourceKey: t.String(),
        externalRecordId: t.String(),
        providerKind: t.Union([t.Literal('anthropic'), t.Literal('openai-compatible'), t.Literal('universal'), t.Literal('cli-tool')]),
        displayName: t.String(),
        enabled: t.Boolean(),
        credentialRef: nullableString,
        iconSlug: nullableString,
        lastResolvedFingerprint: t.String(),
        createdAt: t.Number(),
        updatedAt: t.Number(),
      }),
    },
  })
  .patch('/external-provider-sources/:sourceKey/records/:externalRecordId/runtime-target', ({ params, body }) => {
    const target = ExternalProviderSources.updateExternalRuntimeTargetEnabled(
      params.sourceKey,
      params.externalRecordId,
      body.enabled,
    )
    if (!target) {
      throw new AppError({
        code: 'external_provider_target_not_found',
        status: 404,
        message: 'External provider target not found',
        details: {
          sourceKey: params.sourceKey,
          externalRecordId: params.externalRecordId,
        },
      })
    }
    return target
  }, {
    detail: {
      summary: 'Update runtime target metadata for an external provider record',
    },
    params: ExternalProviderSourcesModel.recordParams,
    body: ExternalProviderSourcesModel.runtimeTargetPatch,
    response: {
      200: t.Object({
        id: t.String(),
        sourceKey: t.String(),
        externalRecordId: t.String(),
        providerKind: t.Union([t.Literal('anthropic'), t.Literal('openai-compatible'), t.Literal('universal'), t.Literal('cli-tool')]),
        displayName: t.String(),
        enabled: t.Boolean(),
        credentialRef: nullableString,
        iconSlug: nullableString,
        lastResolvedFingerprint: t.String(),
        createdAt: t.Number(),
        updatedAt: t.Number(),
      }),
    },
  })
