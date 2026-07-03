import { randomUUID } from 'node:crypto'

import type { UIMessage } from 'ai'

import { AppError } from '../../../errors/app-error'
import { serializeChatError } from '../run/errors'
import { runRegistry } from '../run-registry'
import type { SessionSteerTurnDto, SubmitSessionSteerTurnInput } from '../queue/session-queue'
import {
  assertRuntimeCompatibleTarget,
  getSessionRunContext
} from '../runtime-session-context'
import { annotateContinuationMessage, insertCompletedUserMessage } from '../run/turn-draft'
import { createUserMessage } from '../ui-message'

export interface SubmitSessionSteerTurnDeps {
  finalizeInterruptedPersistedStreamingSessionIfIdle(sessionId: string): Promise<void>
  warn(message: string, payload: Record<string, unknown>): void
}

export async function submitSessionSteerTurn(
  input: SubmitSessionSteerTurnInput,
  deps: SubmitSessionSteerTurnDeps
): Promise<SessionSteerTurnDto> {
  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_steer_empty',
      status: 400,
      message: 'Chat steer requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  await deps.finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)
  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (!runId) {
    throw new AppError({
      code: 'chat_steer_no_active_run',
      status: 409,
      message: 'Chat steer requires an active run',
      details: { sessionId: input.sessionId }
    })
  }

  const activeRun = runRegistry.getActiveRun(runId)
  if (
    !activeRun?.runtime.capabilities.supportsSteerTurn ||
    !activeRun.runtime.steerTurn ||
    activeRun.terminalStatus
  ) {
    throw new AppError({
      code: 'chat_steer_not_supported',
      status: 409,
      message: 'Active chat run does not support live steering',
      details: { sessionId: input.sessionId, runId }
    })
  }

  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const requestedProviderTargetId = input.providerTargetId?.trim() || null
  if (requestedProviderTargetId && requestedProviderTargetId !== activeRun.providerTargetId) {
    throw new AppError({
      code: 'chat_steer_context_mismatch',
      status: 409,
      message: 'Live steer request does not match the active run context',
      details: { sessionId: input.sessionId, runId }
    })
  }

  const sourceMessageId = activeRun.messageId
  const splitParts = structuredClone(activeRun.finalMessage.parts) as UIMessage['parts']
  const steerMessage = annotateContinuationMessage(
    createUserMessage(`steer-${randomUUID()}`, text, files, contextParts),
    { mode: 'steer', sourceMessageId, splitParts }
  )
  try {
    await activeRun.runtime.steerTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      message: steerMessage
    })
  } catch (error) {
    deps.warn('runtime live steer failed', {
      error,
      sessionId: input.sessionId,
      runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    throw new AppError({
      code: 'chat_steer_rejected',
      status: 409,
      message: 'Runtime rejected live steer',
      details: { sessionId: input.sessionId, runId, error: serializeChatError(error).text }
    })
  }

  try {
    await insertCompletedUserMessage({
      sessionId: input.sessionId,
      message: steerMessage,
      parentMessageId: sourceMessageId
    })
  } catch (error) {
    deps.warn('runtime live steer was applied but history persistence failed', {
      error,
      sessionId: input.sessionId,
      runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    throw error
  }

  return {
    ok: true,
    sessionId: input.sessionId,
    runId,
    sourceMessageId,
    message: steerMessage
  }
}
