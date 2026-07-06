import { messages } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { appendDecidedSessionEvents } from '../es/commands'
import { publishSessionTailEvents } from '../es/event-tail'
import { runSessionActorTask } from '../es/session-actor'
import { submitRuntimeToolApprovalIfPending } from '../pending-tool-approval'
import { assertStoredSession } from '../runtime-session-context'
import { parseStoredMessageSnapshot } from '../stream/projection'
import {
  applyPlanImplementationApprovalResponse,
  assertPlanImplementationApprovalId,
} from './plan-implementation-message'

export async function resolvePlanImplementationApproval(input: {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
}): Promise<{ message: UIMessage }> {
  assertStoredSession(input.sessionId)
  assertPlanImplementationApprovalId(input.approvalId)

  const result = await runSessionActorTask(input.sessionId, () => db().transaction((tx) => {
    const row = tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
      .get()
    if (!row) {
      throw new AppError({
        code: 'chat_message_not_found',
        status: 404,
        message: 'Chat message was not found',
        details: {
          sessionId: input.sessionId,
          messageId: input.messageId,
        },
      })
    }
    if (row.role !== 'assistant') {
      throw new AppError({
        code: 'chat_plan_implementation_approval_invalid',
        status: 400,
        message: 'Plan implementation approval must target an assistant message',
        details: {
          sessionId: input.sessionId,
          messageId: input.messageId,
          role: row.role,
        },
      })
    }

    const message = applyPlanImplementationApprovalResponse({
      message: parseStoredMessageSnapshot(row, 'assistant'),
      sessionId: input.sessionId,
      messageId: input.messageId,
      approvalId: input.approvalId,
      approved: input.approved,
    })
    const storedEvents = appendDecidedSessionEvents(tx, input.sessionId, [
      {
        type: 'PlanImplementationResponded',
        payload: {
          sessionId: input.sessionId,
          messageId: input.messageId,
          approvalId: input.approvalId,
          approved: input.approved,
          updatedAt: currentUnixSeconds(),
        },
      },
    ])
    return { message, storedEvents }
  }))
  publishSessionTailEvents(result.storedEvents)

  submitRuntimeToolApprovalIfPending({
    sessionId: input.sessionId,
    requestId: input.approvalId,
    approved: input.approved,
    reason: input.approved
      ? 'User approved plan implementation.'
      : 'User denied plan implementation.',
  })

  return { message: result.message }
}
