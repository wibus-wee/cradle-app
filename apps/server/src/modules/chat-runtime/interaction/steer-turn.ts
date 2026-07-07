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
import {
  assertRuntimeCompatibleTarget,
  getSessionRunContext,
} from '../runtime-session-context'
import { createUserMessage } from '../ui-message'

export interface SubmitSessionSteerTurnDeps {
  finalizeInterruptedPersistedStreamingSessionIfIdle: (sessionId: string) => Promise<void>
  scheduleSessionQueueDrain: (sessionId: string) => void
  warn: (message: string, payload: Record<string, unknown>) => void
}

/**
 * Enqueue the steer request as a regular queue item instead of live-steering. Used both when the
 * target runtime's `steer` capability is `'queue-fallback'`/`'unsupported'`... no: `'unsupported'`
 * rejects outright before this is called; this path handles `'queue-fallback'` runtimes and
 * `'native'` runtimes with no matching active run to steer.
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
  }
  const queueItem: ChatSessionQueueItemDto = await enqueueSessionQueueItem(enqueueInput, {
    finalizeInterruptedPersistedStreamingSessionIfIdle: deps.finalizeInterruptedPersistedStreamingSessionIfIdle,
    scheduleSessionQueueDrain: deps.scheduleSessionQueueDrain,
  })
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

  await deps.finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)

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

  // Server-side auto-fallback (doc §3.4): the client never branches on a fallback error code.
  // `queue-fallback` runtimes always queue; `native` runtimes queue only when there's no active
  // run they can actually steer (not started yet, already finished, or targeting a different
  // provider context) rather than rejecting the request outright.
  if (runtime.capabilities.steer === 'queue-fallback' || !activeRun || !steerHook || !hasMatchingActiveRun) {
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
      message: steerMessage,
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
      details: { sessionId: input.sessionId, runId: activeRun.runId, error: serializeChatError(error).text },
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
