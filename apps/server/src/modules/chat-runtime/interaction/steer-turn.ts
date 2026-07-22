import { randomUUID } from 'node:crypto'

import type { UIMessage } from 'ai'

import { AppError } from '../../../errors/app-error'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import { enqueueSessionQueueItem } from '../queue/api'
import type {
  ChatSessionQueueItemDto,
  EnqueueSessionQueueItemInput,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput,
} from '../queue/session-queue'
import { serializeChatError } from '../run/errors'
import { annotateContinuationMessage, insertCompletedUserMessage } from '../run/turn-draft'
import { runRegistry } from '../run-registry'
import { assertRuntimeCompatibleTarget, getSessionRunContext } from '../runtime-session-context'
import { createUserMessage, projectLightOcrMessage } from '../ui-message'

export interface SubmitSessionSteerTurnDeps {
  scheduleSessionQueueDrain: (sessionId: string) => void
  /**
   * Synara non-Codex steer: interrupt the live turn so the front-of-queue steer
   * drains as the next run. Optional so unit tests can omit cancel.
   */
  cancelActiveSessionRun?: (sessionId: string) => Promise<void>
  warn: (message: string, payload: Record<string, unknown>) => void
}

/**
 * Enqueue the steer request as a durable queue item (Synara non-Codex path / queue-fallback).
 * When a live turn is active, interrupt it so the steer jumps ahead after settlement.
 */
async function enqueueSteerRequestAsQueueItem(
  input: SubmitSessionSteerTurnInput,
  deps: SubmitSessionSteerTurnDeps,
): Promise<SessionSteerTurnDto> {
  const enqueueInput: EnqueueSessionQueueItemInput = {
    sessionId: input.sessionId,
    text: input.text,
    files: input.files,
    contextParts: input.contextParts,
    providerTargetId: input.providerTargetId,
    mode: 'steer',
    placement: 'front',
  }
  const queueItem: ChatSessionQueueItemDto = await enqueueSessionQueueItem(enqueueInput, {
    scheduleSessionQueueDrain: deps.scheduleSessionQueueDrain,
  })

  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (runId && deps.cancelActiveSessionRun) {
    try {
      await deps.cancelActiveSessionRun(input.sessionId)
    }
    catch (error) {
      deps.warn('steer queue interrupt failed after enqueue', {
        error,
        sessionId: input.sessionId,
        runId,
        queueItemId: queueItem.id,
      })
    }
  }

  return {
    mode: 'queued',
    ok: true,
    sessionId: input.sessionId,
    queueItem,
  }
}

export async function submitSessionSteerTurn(
  input: SubmitSessionSteerTurnInput,
  deps: SubmitSessionSteerTurnDeps,
): Promise<SessionSteerTurnDto> {
  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_steer_empty',
      status: 400,
      message: 'Chat steer requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId },
    })
  }

  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId,
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId },
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)
  if (!runtime || runtime.capabilities.steer === 'unsupported') {
    throw new AppError({
      code: 'chat_steer_not_supported',
      status: 409,
      message: 'Chat runtime does not support live steering or queueing a steer request',
      details: { sessionId: input.sessionId, runtimeKind },
    })
  }

  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  const activeRun = runId ? runRegistry.getActiveRun(runId) : undefined
  const requestedProviderTargetId = input.providerTargetId?.trim() || null
  const steerHook = activeRun?.runtime.steerTurn
  const hasMatchingActiveRun
    = !!activeRun
      && !activeRun.terminalStatus
      && !!steerHook
      && (!requestedProviderTargetId || requestedProviderTargetId === activeRun.providerTargetId)

  // Synara: only Codex (native) live-steers. queue-fallback and missing/mismatched runs
  // enqueue at the front and interrupt the live turn when present.
  if (
    runtime.capabilities.steer === 'queue-fallback'
    || !activeRun
    || !steerHook
    || !hasMatchingActiveRun
  ) {
    return await enqueueSteerRequestAsQueueItem(input, deps)
  }

  const sourceMessageId = activeRun.messageId
  const splitParts = structuredClone(activeRun.finalMessage.parts) as UIMessage['parts']
  const steerMessage = annotateContinuationMessage(
    createUserMessage(`steer-${randomUUID()}`, text, files, contextParts),
    { mode: 'steer', sourceMessageId, splitParts },
  )
  try {
    await steerHook.call(activeRun.runtime, {
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      message: projectLightOcrMessage(steerMessage),
    })
  }
  catch (error) {
    deps.warn('runtime live steer failed', {
      error,
      sessionId: input.sessionId,
      runId: activeRun.runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
    })
    throw new AppError({
      code: 'chat_steer_rejected',
      status: 409,
      message: 'Runtime rejected live steer',
      details: {
        sessionId: input.sessionId,
        runId: activeRun.runId,
        error: serializeChatError(error).text,
      },
    })
  }

  try {
    await insertCompletedUserMessage({
      sessionId: input.sessionId,
      message: steerMessage,
      parentMessageId: sourceMessageId,
    })
  }
  catch (error) {
    deps.warn('runtime live steer was applied but history persistence failed', {
      error,
      sessionId: input.sessionId,
      runId: activeRun.runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
    })
    throw error
  }

  return {
    mode: 'steered',
    ok: true,
    sessionId: input.sessionId,
    runId: activeRun.runId,
    sourceMessageId,
    message: steerMessage,
  }
}
