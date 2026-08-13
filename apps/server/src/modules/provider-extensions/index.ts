import { Elysia, t } from 'elysia'

import { ProviderExtensionsModel } from './model'
import {
  listProviderTargetExtensions,
  setProviderTargetExtensionEnabled,
} from './service'

export const providerExtensions = new Elysia({
  prefix: '/provider-targets/:providerTargetId/extensions',
  detail: { tags: ['provider-extensions'] },
})
  .get(
    '/',
    ({ params }) => listProviderTargetExtensions(params.providerTargetId),
    {
      detail: {
        'summary': 'List extensions for a Provider target',
        'description': 'Returns registered and remembered per-Provider extensions without activation state or credential values.',
        'x-cradle-cli': { command: ['provider', 'extension', 'list'] },
      },
      params: ProviderExtensionsModel.params,
      response: { 200: t.Array(ProviderExtensionsModel.binding) },
    },
  )
  .put(
    '/',
    ({ params, body }) => setProviderTargetExtensionEnabled({
      providerTargetId: params.providerTargetId,
      owner: body.owner,
      id: body.id,
      enabled: body.enabled,
    }),
    {
      detail: {
        'summary': 'Enable or disable a Provider extension',
        'description': 'Awaits the extension lifecycle transition. Conversion direction and output kind are owned by the extension.',
        'x-cradle-cli': { command: ['provider', 'extension', 'set'] },
      },
      params: ProviderExtensionsModel.params,
      body: ProviderExtensionsModel.setEnabledBody,
      response: { 200: ProviderExtensionsModel.binding },
    },
  )
