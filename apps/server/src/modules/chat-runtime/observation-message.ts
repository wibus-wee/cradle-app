import { randomUUID } from 'node:crypto'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { readSessionExecutionTarget } from '../session/remote-projection'
import * as Session from '../session/service'
import { commitSessionEvents } from './es/commands'
import { toDurableMessagePayload } from './message-durable-payload'
import { annotateObservationMessage, createUserMessage } from './ui-message'

export const JARVIS_AMBIENT_SESSION_ORIGIN = 'jarvis-ambient'

export interface AppendSessionObservationInput {
  sessionId: string
  text: string
  entity?: string
  entityType?: string
  durationMs?: number
  endReason?: string
}

export interface AppendSessionObservationResult {
  messageId: string
}

function assertObservationSessionEligible(sessionId: string): void {
  const session = Session.get(sessionId)
  if (!session) {
    throw new AppError({
      code: 'session_not_found',
      status: 404,
      message: 'Session not found',
      details: { sessionId },
    })
  }
  if (session.archivedAt !== null) {
    throw new AppError({
      code: 'session_archived',
      status: 409,
      message: 'Cannot append observations to an archived session',
      details: { sessionId },
    })
  }
  const execution = readSessionExecutionTarget(sessionId)
  if (execution.kind === 'remote-host') {
    throw new AppError({
      code: 'session_remote_projection',
      status: 409,
      message: 'Cannot append observations to a remote-projected session',
      details: { sessionId },
    })
  }
  if (session.origin !== JARVIS_AMBIENT_SESSION_ORIGIN) {
    throw new AppError({
      code: 'observation_session_not_eligible',
      status: 409,
      message: 'Session is not eligible for UI activity observations',
      details: { sessionId, origin: session.origin },
    })
  }
}

export async function appendSessionObservationMessage(
  input: AppendSessionObservationInput,
): Promise<AppendSessionObservationResult> {
  const text = input.text.trim()
  if (!text) {
    throw new AppError({
      code: 'observation_text_required',
      status: 400,
      message: 'Observation text must not be empty',
    })
  }
  if (text.includes('<cradle_context>')) {
    throw new AppError({
      code: 'observation_text_invalid',
      status: 400,
      message: 'Observation text must not include cradle context blocks',
    })
  }

  assertObservationSessionEligible(input.sessionId)

  const messageId = randomUUID()
  const message = annotateObservationMessage(createUserMessage(messageId, text), {
    entity: input.entity,
    entityType: input.entityType,
    durationMs: input.durationMs,
    endReason: input.endReason,
  })
  const now = currentUnixSeconds()
  const durable = await toDurableMessagePayload({
    sessionId: input.sessionId,
    message,
  })

  await commitSessionEvents(input.sessionId, [
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: messageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: durable.content,
          messageJson: durable.messageJson,
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  ])

  return { messageId }
}
