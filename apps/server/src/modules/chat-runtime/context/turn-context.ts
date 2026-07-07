import type { Session } from '@cradle/db'
import { agents, sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { readTrustedAgentRuntimeConfig } from '../../../helpers/agent-runtime-config'
import { readPositiveIntegerEnv } from '../../../helpers/env'
import { getSystemWorkflow } from '../../../helpers/system-workflow'
import { db } from '../../../infra'
import type { CradleTurnTranscript } from '../transcript'
import { resolveCradleTurnTranscript } from '../transcript'

const DEFAULT_TURN_CONTEXT_MAX_MESSAGES = 12
const DEFAULT_TURN_CONTEXT_MAX_CHARS = 120_000

export interface ChatTurnContext {
  systemPrompt?: string
  transcript?: CradleTurnTranscript
  history?: UIMessage[]
}

export function resolveSessionSystemPrompt(session: Session | null | undefined): string | undefined {
  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = readTrustedAgentRuntimeConfig(agent?.configJson).systemPrompt
  }

  const workflow = getSystemWorkflow()
  if (workflow) {
    systemPrompt = systemPrompt ? `${workflow}\n\n---\n\n${systemPrompt}` : workflow
  }

  return systemPrompt
}

export function resolveTurnContext(input: {
  sessionId: string
  draftMessageId: string
  draftUserMessageId: string
}): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

  const systemPrompt = resolveSessionSystemPrompt(session)
  // Chronicle per-turn memory context is intentionally disabled for now.
  // It is dynamic and unstable; when re-enabled, decide whether it belongs in system prompt or a lower-authority context channel.
  const transcript = resolveBoundedTurnHistory({
    sessionId: input.sessionId,
    excludedMessageIds: new Set([input.draftMessageId, input.draftUserMessageId]),
  })

  return {
    systemPrompt,
    transcript,
    history: transcript.history.length > 0 ? transcript.history : undefined,
  }
}

function resolveBoundedTurnHistory(input: {
  sessionId: string
  excludedMessageIds: Set<string>
}): CradleTurnTranscript {
  return resolveCradleTurnTranscript({
    sessionId: input.sessionId,
    excludedMessageIds: input.excludedMessageIds,
    maxMessages: readPositiveIntegerEnv(
      'CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES',
      DEFAULT_TURN_CONTEXT_MAX_MESSAGES,
    ),
    maxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS',
      DEFAULT_TURN_CONTEXT_MAX_CHARS,
    ),
  })
}
