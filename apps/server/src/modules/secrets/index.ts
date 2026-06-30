import { Elysia, t } from 'elysia'

import { SecretsModel } from './model'
import * as Secrets from './service'

export const secrets = new Elysia({
  prefix: '/secrets',
  detail: { tags: ['secrets'] },
})
  .get('/', () => Secrets.listSecrets(), {
    detail: {
      'summary': 'List secrets',
      'x-cradle-cli': {
        command: ['secret', 'list'],
      },
    },
    response: { 200: t.Array(SecretsModel.secretMetadata) },
  })
  .post('/', ({ body }) => Secrets.saveSecret(body), {
    detail: { summary: 'Save a secret' },
    body: SecretsModel.saveBody,
    response: { 200: SecretsModel.secretMetadata },
  })
  .delete('/:id', ({ params }) => {
    Secrets.removeSecret(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete a secret',
      'x-cradle-cli': {
        command: ['secret', 'delete'],
      },
    },
    params: SecretsModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
