import { Elysia } from 'elysia'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { registerChatRuntimeReadModelProjector } from '../chat-runtime/read-model-projectors'
import * as Maintenance from '../maintenance/service'
import * as Session from '../session/service'
import { executeRecallAttune } from './attune-evaluator'
import { requestAttunement, resolveAttunementRequest } from './attune-service'
import { executeRecallQuery } from './evaluator'
import { RecallModel } from './model'
import {
  projectRecallMessage,
  projectRecallRun,
  projectRecallToolEventRecord,
  rebuildRecallProjection,
  reconcileRecallProjection,
} from './service'

const AttuneIntentSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('remember'), content: z.string().min(1), evidenceIds: z.array(z.string().min(1)).min(1) }),
  z.object({ operation: z.literal('forget'), id: z.string().min(1) }),
])

let recallProjectorRegistered = false

function recallContext(chatSessionId: string) {
  const session = Session.get(chatSessionId)
  if (!session?.workspaceId) {
    throw new AppError({ code: 'recall_session_not_found', status: 404, message: 'Recall requires an existing workspace-bound chat session.' })
  }
  return { chatSessionId: session.id, workspaceId: session.workspaceId, workId: null }
}

export const recall = new Elysia({
  prefix: '/recall',
  detail: { tags: ['recall'] },
}).post(
  '/query',
  async ({ body }) => {
    const outcome = await executeRecallQuery({
      context: recallContext(body.chatSessionId),
      code: body.code,
    })
    return outcome
  },
  {
    detail: { summary: 'Run a scoped Recall query for an active chat session' },
    body: RecallModel.queryBody,
    response: { 200: RecallModel.queryResponse },
  },
).post(
  '/attune',
  async ({ body }) => {
    const context = recallContext(body.chatSessionId)
    const outcome = await executeRecallAttune({ context, code: body.code })
    if (outcome.kind !== 'completed') {
      const message = outcome.kind === 'timeout' || outcome.kind === 'check-passed'
        ? 'Attune program did not complete.'
        : outcome.error
      throw new AppError({ code: 'recall_attune_program_invalid', status: 400, message })
    }
    return requestAttunement({ context, intent: AttuneIntentSchema.parse(outcome.result) })
  },
  { detail: { summary: 'Request a user-approved Recall attunement' }, body: RecallModel.queryBody },
).post(
  '/attune/:id/resolve',
  ({ params, body }) => resolveAttunementRequest({
    context: recallContext(body.chatSessionId),
    requestId: params.id,
    approved: body.approved,
  }),
  {
    detail: { summary: 'Resolve a pending Recall attunement request' },
    params: RecallModel.attuneResolveParams,
    body: RecallModel.attuneResolveBody,
  },
)

export function initializeRecallProjection(): void {
  if (!recallProjectorRegistered) {
    registerChatRuntimeReadModelProjector({
      projectMessage: projectRecallMessage,
      projectRun: projectRecallRun,
      projectRunSnapshotEvent: projectRecallToolEventRecord,
    })
    recallProjectorRegistered = true
  }
  reconcileRecallProjection()
  Maintenance.registerTask({
    ownerNamespace: 'recall',
    key: 'reconcile-projection',
    title: 'Reconcile Recall projection',
    intervalMs: 15 * 60 * 1000,
    runOnStart: false,
    manuallyRunnable: true,
    run: () => ({ ...reconcileRecallProjection() }),
  })
}

export function repairRecallProjection(): void {
  db().transaction(tx => rebuildRecallProjection(tx))
}
