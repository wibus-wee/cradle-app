import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ProfilesModel } from './model'
import * as Profiles from './service'

export const profiles = new Elysia({
  prefix: '/profiles',
  detail: { tags: ['profiles'] },
})
  .get('/', () => Profiles.listProfiles(), {
    detail: {
      'summary': 'List profiles',
      'x-cradle-cli': {
        command: ['profile', 'list'],
      },
    },
    response: { 200: t.Array(ProfilesModel.agentProfile) },
  })
  .get('/:id', ({ params }) => {
    const p = Profiles.getProfile(params.id)
    if (!p) {
      throw new AppError({ code: 'profile_not_found', status: 404, message: 'Profile not found' })
    }
    return p
  }, {
    detail: {
      'summary': 'Get profile by ID',
      'x-cradle-cli': {
        command: ['profile', 'get'],
      },
    },
    params: ProfilesModel.idParams,
    response: { 200: ProfilesModel.agentProfile },
  })
  .put('/:id', async ({ params, body }) => {
    return await Profiles.upsertProfile({
      id: params.id,
      name: body.name,
      providerKind: body.providerKind,
      enabled: body.enabled,
      configJson: JSON.stringify(body.config),
      credentialRef: body.credentialRef ?? null,
      iconSlug: body.iconSlug !== undefined ? (body.iconSlug ?? null) : undefined,
      providerId: body.providerId !== undefined ? (body.providerId ?? null) : undefined,
    })
  }, {
    detail: {
      'summary': 'Create or update profile',
      'x-cradle-cli': {
        command: ['profile', 'set'],
      },
    },
    params: ProfilesModel.idParams,
    body: ProfilesModel.upsertBody,
    response: { 200: ProfilesModel.agentProfile },
  })
  .post('/:id/bind-provider', async ({ params, body }) => {
    return await Profiles.bindProfileProvider(params.id, {
      providerId: body.providerId,
      applyEndpointDefaults: body.applyEndpointDefaults,
    })
  }, {
    detail: {
      summary: 'Bind profile to an explicit Provider contribution',
      description: 'Sets providerId from an explicit client choice. Does not infer identity from endpoint URL. Optional applyEndpointDefaults rewrites URLs from contribution defaults.',
    },
    params: ProfilesModel.idParams,
    body: ProfilesModel.bindProviderBody,
    response: { 200: ProfilesModel.agentProfile },
  })
  .delete('/:id', async ({ params }) => {
    await Profiles.removeProfile(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete profile',
      'x-cradle-cli': {
        command: ['profile', 'delete'],
      },
    },
    params: ProfilesModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/:id/icon', ({ params, body }) => {
    const profile = Profiles.getProfile(params.id)
    if (!profile) {
      throw new AppError({ code: 'profile_not_found', status: 404, message: 'Profile not found' })
    }
    return Profiles.updateIcon(params.id, body.iconSlug)
  }, {
    detail: {
      summary: 'Update profile icon',
    },
    params: ProfilesModel.idParams,
    body: t.Object({ iconSlug: t.Nullable(t.String()) }),
    response: { 200: ProfilesModel.agentProfile },
  })
  .patch('/:id/custom-models', async ({ params, body }) => {
    const profile = Profiles.getProfile(params.id)
    if (!profile) {
      throw new AppError({ code: 'profile_not_found', status: 404, message: 'Profile not found' })
    }
    return Profiles.updateCustomModels(params.id, body.models)
  }, {
    detail: {
      'summary': 'Update custom models for a profile',
      'x-cradle-cli': {
        command: ['profile', 'custom-models'],
      },
    },
    params: ProfilesModel.idParams,
    body: ProfilesModel.customModelsBody,
    response: { 200: t.Array(ProfilesModel.customModelEntry) },
  })
