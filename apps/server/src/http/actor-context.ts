import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../errors/app-error'
import { db } from '../infra'
import { readRuntimeDefaultActor } from '../modules/provider-contracts/runtime-compatibility'

export const CRADLE_CHAT_SESSION_ID_HEADER = 'x-cradle-chat-session-id'

export type MutationActorKind = 'user' | 'agent' | 'system' | 'provider-target'

export interface MutationActor {
  kind: MutationActorKind
  id: string
  source: 'default-user' | 'chat-session'
  chatSessionId: string | null
}

const DEFAULT_USER_ACTOR: MutationActor = {
  kind: 'user',
  id: '__self__',
  source: 'default-user',
  chatSessionId: null,
}

export function resolveActorContext(request: Request): MutationActor {
  const chatSessionId = request.headers.get(CRADLE_CHAT_SESSION_ID_HEADER)?.trim()
  if (!chatSessionId) {
    return DEFAULT_USER_ACTOR
  }

  const session = db()
    .select({
      id: sessions.id,
      agentId: sessions.agentId,
      providerTargetId: sessions.providerTargetId,
      runtimeKind: sessions.runtimeKind,
    })
    .from(sessions)
    .where(eq(sessions.id, chatSessionId))
    .get()

  if (!session) {
    throw new AppError({
      code: 'runtime_context_not_found',
      status: 401,
      message: 'Runtime context not found',
      details: { chatSessionId },
    })
  }

  if (session.agentId) {
    return {
      kind: 'agent',
      id: session.agentId,
      source: 'chat-session',
      chatSessionId,
    }
  }

  const runtimeActor = readRuntimeDefaultActor(session.runtimeKind)
  if (runtimeActor) {
    return {
      kind: runtimeActor.kind,
      id: runtimeActor.id,
      source: 'chat-session',
      chatSessionId,
    }
  }

  if (session.providerTargetId) {
    return {
      kind: 'provider-target',
      id: session.providerTargetId,
      source: 'chat-session',
      chatSessionId,
    }
  }

  return {
    kind: 'user',
    id: '__self__',
    source: 'chat-session',
    chatSessionId,
  }
}
