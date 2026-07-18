import type { RuntimeHarnessContext } from '@cradle/chat-runtime-contracts'
import type { Session } from '@cradle/db'
import { agents, sessionGroups, sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, eq, isNull, ne } from 'drizzle-orm'

import { readTrustedAgentRuntimeConfig } from '../../../helpers/agent-runtime-config'
import { readPositiveIntegerEnv } from '../../../helpers/env'
import { db } from '../../../infra'
import type { CradleTurnTranscript } from '../transcript'
import { resolveCradleTurnTranscript } from '../transcript'
import { resolveHarnessContextFragments } from './context-source-registry'
import {
  getCradleHarnessSystemInstructions,
  getCradleWorkModeSystemInstructions,
} from './system-instructions'

/** Matches `modules/work/agent-context` WORK_HARNESS_FRAGMENT_KEY. */
const CRADLE_WORK_HARNESS_FRAGMENT_KEY = 'cradle-work'

const DEFAULT_TURN_CONTEXT_MAX_MESSAGES = 12
const DEFAULT_TURN_CONTEXT_MAX_CHARS = 120_000

export interface ChatTurnContext {
  systemPrompt?: string
  harness?: RuntimeHarnessContext
  transcript?: CradleTurnTranscript
  history?: UIMessage[]
}

function resolveSessionGroupPrompt(session: Session): string | undefined {
  if (!session.sessionGroupId) {
    return undefined
  }

  const group = db()
    .select({
      id: sessionGroups.id,
      title: sessionGroups.title,
    })
    .from(sessionGroups)
    .where(eq(sessionGroups.id, session.sessionGroupId))
    .get()
  if (!group) {
    return undefined
  }

  const siblings = db()
    .select({
      id: sessions.id,
      title: sessions.title,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionGroupId, group.id),
        ne(sessions.id, session.id),
        isNull(sessions.archivedAt),
      ),
    )
    .all()

  const siblingLines = siblings.length > 0
    ? siblings.map(sibling => `- ${sibling.title || sibling.id}`)
    : ['- (none)']

  return [
    '## Session Group',
    `You are working in Session Group "${group.title}".`,
    'Sibling sessions in this group (separate conversation contexts):',
    ...siblingLines,
    'Do not assume shared transcript with sibling sessions.',
  ].join('\n')
}

export function resolveSessionHarness(session: Session | null | undefined): Pick<ChatTurnContext, 'systemPrompt' | 'harness'> {
  let systemPrompt = getCradleHarnessSystemInstructions() ?? undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    const agentPrompt = readTrustedAgentRuntimeConfig(agent?.configJson).systemPrompt
    if (agentPrompt) {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${agentPrompt}` : agentPrompt
    }
  }

  const sessionGroupPrompt = session ? resolveSessionGroupPrompt(session) : undefined
  if (sessionGroupPrompt) {
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${sessionGroupPrompt}`
      : sessionGroupPrompt
  }

  const fragments = session ? resolveHarnessContextFragments(session) : []
  const isPrimaryWorkThread = fragments.some(fragment => fragment.key === CRADLE_WORK_HARNESS_FRAGMENT_KEY)
  if (isPrimaryWorkThread) {
    const workModePrompt = getCradleWorkModeSystemInstructions()
    if (workModePrompt) {
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n---\n\n${workModePrompt}`
        : workModePrompt
    }
  }

  return {
    systemPrompt,
    harness: fragments.length > 0 ? { fragments } : undefined,
  }
}

export function resolveSessionSystemPrompt(session: Session | null | undefined): string | undefined {
  return resolveSessionHarness(session).systemPrompt
}

export function resolveTurnContext(input: {
  sessionId: string
  draftMessageId: string
  draftUserMessageId: string
}): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  const harness = resolveSessionHarness(session)
  // Chronicle per-turn memory context is intentionally disabled for now.
  // It is dynamic and unstable; when re-enabled, decide whether it belongs in system prompt or a lower-authority context channel.
  const transcript = resolveBoundedTurnHistory({
    sessionId: input.sessionId,
    excludedMessageIds: new Set([input.draftMessageId, input.draftUserMessageId]),
  })

  return {
    ...harness,
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
