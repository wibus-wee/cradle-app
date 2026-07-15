import type { Session } from '@cradle/db'
import { agents, sessionGroups, sessions, works, workThreads } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, eq, isNull, ne } from 'drizzle-orm'

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

function resolvePrimaryWorkPrompt(session: Session): string | undefined {
  const work = db()
    .select({
      id: works.id,
    })
    .from(workThreads)
    .innerJoin(works, eq(works.id, workThreads.workId))
    .where(and(eq(workThreads.sessionId, session.id), eq(workThreads.role, 'primary')))
    .get()
  if (!work) {
    return undefined
  }

  return [
    '## Cradle Work',
    '',
    '## CRITICAL',
    '',
    'Do not attempt to complete this Work without following the instructions below.',
    'This is an active Cradle Work session. Implement and verify the objective in the current managed Worktree.',
    'You are explicitly authorized to create coherent local commits for this Work. Keep the checkout clean.',
    'When committing, always use: git commit -m "<message>" --trailer "Co-authored-by: Cradle Agent <cradleagent@wibus.ren>"',
    '',
    '## Work Lifecycle',
    '',
    'When implementation is complete:',
    '1. Call `work_prepare` with this Work ID, a clear title, summary, and test plan.',
    '2. If `work_prepare` returns an error, resolve the issue and try again.',
    '3. After `work_prepare` succeeds, wait for the user to review. Do NOT automatically submit.',
    '4. When the user requests submission, call `work submit` to create/update the Draft PR.',
    '5. After Draft PR creation, Cradle automatically registers Session Awaits for CI and review.',
    '6. When current Work, PR, or Await state matters, inspect it on demand with `cradle work get <Work ID>`.',
    '7. Wait for CI and review results. Do NOT poll or manually check GitHub.',
    '8. When Session Awaits trigger (CI passed, review approved), the results will be delivered to this session.',
    '',
    'Do not run work submit, push, create or update a pull request, mark ready, or merge unless the user explicitly requests that action.',
    '',
    `Active Work ID: ${work.id}`,
  ].join('\n')
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

  const sessionGroupPrompt = session ? resolveSessionGroupPrompt(session) : undefined
  if (sessionGroupPrompt) {
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${sessionGroupPrompt}`
      : sessionGroupPrompt
  }

  const workPrompt = session ? resolvePrimaryWorkPrompt(session) : undefined
  if (workPrompt) {
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${workPrompt}`
      : workPrompt
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
