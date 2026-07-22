import { Elysia } from 'elysia'

import { db } from '../../infra'
import { rebuildRecallProjection } from './service'

export const recall = new Elysia({
  prefix: '/recall',
  detail: { tags: ['recall'] },
})

export function initializeRecallProjection(): void {
  db().transaction((tx) => {
    rebuildRecallProjection(tx)
  })
}
