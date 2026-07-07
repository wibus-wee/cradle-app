import { messages, sessions } from '@cradle/db'
import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { readProviderStateSnapshot } from '../chat-runtime-providers/kit/state-snapshot'
import * as SessionService from '../session/service'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import { commitSessionEvents } from './es/commands'
import { createSessionTitleGenerationError } from './run/errors'
import { runRegistry } from './run-registry'
import type { GenerateSessionTitleInput } from './runtime-provider-types'
import type { ResolvedRuntimeSessionContext } from './runtime-session-context'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  attachBinding,
  buildRuntimeProviderInput,
  resolveRuntimeSessionForContext,
} from './runtime-session-context'
import {
  extractMessageText,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot,
} from './ui-message'

const messageInsertOrder = sql`messages.rowid`

export function reportRuntimeSessionTitle(input: {
  sessionId: string
  title: string
  overwriteUserTitle?: boolean
}): Promise<void> {
  const title = normalizeRuntimeSessionTitle(input.title)
  if (!title) {
    return Promise.resolve()
  }

  const session = db()
    .select({ title: sessions.title, titleSource: sessions.titleSource })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .get()
  if (!session) {
    return Promise.resolve()
  }
  if (
    session.title === title
    && (!input.overwriteUserTitle || session.titleSource === 'provider')
  ) {
    return Promise.resolve()
  }

  // Don't overwrite user-set titles
  if (session.titleSource === 'user' && !input.overwriteUserTitle) {
    return Promise.resolve()
  }
  if (!input.overwriteUserTitle && isTrivialContinuationTitle(title)) {
    return Promise.resolve()
  }

  const updatedAt = currentUnixSeconds()
  return commitSessionEvents(input.sessionId, [
    {
      type: 'TitleChanged',
      payload: {
        sessionId: input.sessionId,
        title,
        titleSource: 'provider',
        updatedAt,
      },
    },
  ])
}

export async function regenerateSessionTitle(
  sessionId: string,
): Promise<SessionService.SessionView> {
  const context = assertRuntimeCompatibleTarget(assertRunnableSession(sessionId))
  const promptText = readFirstUserPromptText(sessionId)
  if (!promptText) {
    throw new AppError({
      code: 'chat_session_title_prompt_not_found',
      status: 400,
      message: 'Chat session does not have a user prompt to name',
      details: { sessionId },
    })
  }

  const registry = getRuntimeRegistry()
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`,
    })
  }
  if (!runtime.generateSessionTitle) {
    throw new AppError({
      code: 'chat_runtime_title_generation_not_supported',
      status: 501,
      message: 'Runtime does not support session title generation',
      details: { sessionId, runtimeKind },
    })
  }

  let resolved: ResolvedRuntimeSessionContext
  const activeRunId = runRegistry.getActiveRunIdForSession(sessionId)
  const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    resolved = {
      context,
      runtimeKind,
      runtime: activeRun.runtime,
      runtimeSession: activeRun.runtimeSession,
      modelId:
        activeRun.modelId
        ?? readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models.currentModelId
        ?? undefined,
    }
  }
 else {
    const runtimeResolution = await resolveRuntimeSessionForContext({
      sessionId,
      context,
      runtimeKind,
      runtime,
    })
    resolved = {
      context,
      runtimeKind,
      runtime,
      runtimeSession: runtimeResolution.runtimeSession,
      modelId:
        runtimeResolution.requestedModelId
        ?? readProviderStateSnapshot(runtimeResolution.runtimeSession.providerStateSnapshot).models.currentModelId
        ?? undefined,
    }
  }

  let title: string | null
  try {
    title = await runtime.generateSessionTitle({
      ...buildRuntimeProviderInput(resolved),
      promptText,
    } satisfies GenerateSessionTitleInput)
  }
 catch (error) {
    throw createSessionTitleGenerationError({
      sessionId,
      runtimeKind: resolved.runtimeKind,
      providerTargetId: resolved.context.providerTarget?.id ?? null,
      error,
    })
  }
  if (!title) {
    throw createSessionTitleGenerationError({
      sessionId,
      runtimeKind: resolved.runtimeKind,
      providerTargetId: resolved.context.providerTarget?.id ?? null,
      reason: 'empty_title',
    })
  }

  await reportRuntimeSessionTitle({
    sessionId,
    title,
    overwriteUserTitle: true,
  })
  attachBinding({
    sessionId,
    providerTargetId: resolved.context.providerTarget?.id ?? null,
    runtimeKind: resolved.runtimeSession.runtimeKind,
    runtimeSession: resolved.runtimeSession,
    requestedModelId: resolved.modelId ?? null,
  })

  const updated = SessionService.get(sessionId)
  if (!updated) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }
  return updated
}

export function normalizeRuntimeSessionTitle(title: string): string | null {
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function isTrivialContinuationTitle(title: string): boolean {
  const normalized = title
    .toLocaleLowerCase()
    .replace(/[.!?。！？]+$/g, '')
    .trim()
  return (
    normalized === 'continue'
    || normalized === '继续'
    || normalized === '接着'
    || normalized === '继续执行'
    || normalized === '继续吧'
  )
}

function readFirstUserPromptText(sessionId: string): string | null {
  const rows = db()
    .select({
      messageJson: messages.messageJson,
      content: messages.content,
    })
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.role, 'user'),
        or(
          eq(messages.status, 'complete'),
          eq(messages.status, 'aborted'),
          eq(messages.status, 'failed'),
        ),
        isNull(messages.parentMessageId),
      ),
    )
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  for (const row of rows) {
    try {
      const text = extractMessageText(parseTrustedStoredMessageSnapshot(row.messageJson)).trim()
      if (text && !isTrivialContinuationTitle(text)) {
        return text
      }
    }
 catch {
      // Fall back to the denormalized content column for old or malformed snapshots.
    }

    const fallback = row.content.trim()
    if (fallback && !isTrivialContinuationTitle(fallback)) {
      return fallback
    }
  }

  return null
}
