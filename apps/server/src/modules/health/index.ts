import { Elysia } from 'elysia'

import { HealthModel } from './model'
import * as Health from './service'

export const health = new Elysia({
  prefix: '/health',
  detail: { tags: ['health'] },
})
  .get('', () => Health.check(), {
    detail: {
      'summary': 'Health check',
      'description': 'Server readiness snapshot',
      'x-cradle-cli': {
        command: ['health'],
      },
    },
    response: {
      200: HealthModel.checkResponse,
    },
  })
