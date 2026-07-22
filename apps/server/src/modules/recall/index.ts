import { Elysia } from 'elysia'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as Session from '../session/service'
import { executeRecallQuery } from './evaluator'
import { RecallModel } from './model'
import { rebuildRecallProjection } from './service'

export const recall = new Elysia({
  prefix: '/recall',
  detail: { tags: ['recall'] },
}).post(
  '/query',
  async ({ body }) => {
    const session = Session.get(body.chatSessionId)
    if (!session?.workspaceId) {
      throw new AppError({
        code: 'recall_session_not_found',
        status: 404,
        message: 'Recall requires an existing workspace-bound chat session.',
      })
    }
    const outcome = await executeRecallQuery({
      context: {
        chatSessionId: session.id,
        workspaceId: session.workspaceId,
        workId: null,
      },
      code: body.code,
    })
    return outcome
  },
  {
    detail: { summary: 'Run a scoped Recall query for an active chat session' },
    body: RecallModel.queryBody,
    response: { 200: RecallModel.queryResponse },
  },
)

export function initializeRecallProjection(): void {
  db().transaction((tx) => {
    rebuildRecallProjection(tx)
  })
}
