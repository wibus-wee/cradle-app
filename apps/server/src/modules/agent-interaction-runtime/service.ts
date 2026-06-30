import { randomUUID } from 'node:crypto'

import type { AgentActivity, AgentSession } from '@cradle/db'
import { agentActivities, agentSessions } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'

const AgentActivityInputSchema = z.object({
  agentSessionId: z.string(),
  type: z.custom<AgentActivity['type']>(),
  body: z.string(),
  signal: z.string().nullable().default(null),
  signalMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export function getSession(agentSessionId: string): AgentSession | undefined {
  return db().select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
}

export function requireSession(agentSessionId: string): AgentSession {
  const session = getSession(agentSessionId)
  if (!session) {
    throw new AppError({
      code: 'agent_interaction_session_not_found',
      status: 404,
      message: 'Agent interaction session not found',
      details: { agentSessionId },
    })
  }
  return session
}

export function listSessionsForIssue(issueId: string): AgentSession[] {
  return db()
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.issueId, issueId))
    .orderBy(desc(agentSessions.createdAt))
    .all()
}

export function listActivities(agentSessionId: string): AgentActivity[] {
  requireSession(agentSessionId)
  return db()
    .select()
    .from(agentActivities)
    .where(eq(agentActivities.agentSessionId, agentSessionId))
    .orderBy(agentActivities.createdAt)
    .all()
}

export function createSession(input: {
  issueId: string
  providerTargetId: string
  agentId: string
}): AgentSession {
  const now = currentUnixSeconds()
  return db().insert(agentSessions).values({
    id: randomUUID(),
    issueId: input.issueId,
    providerTargetId: input.providerTargetId,
    agentId: input.agentId,
    chatSessionId: null,
    status: 'created',
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

export function attachChatSession(input: {
  agentSessionId: string
  chatSessionId: string
}): AgentSession | undefined {
  db().update(agentSessions).set({
    chatSessionId: input.chatSessionId,
    updatedAt: currentUnixSeconds(),
  }).where(eq(agentSessions.id, input.agentSessionId)).run()
  return getSession(input.agentSessionId)
}

export function updateSessionStatus(agentSessionId: string, status: AgentSession['status']): AgentSession | undefined {
  db()
    .update(agentSessions)
    .set({ status, updatedAt: currentUnixSeconds() })
    .where(eq(agentSessions.id, agentSessionId))
    .run()
  return getSession(agentSessionId)
}

export function createActivity(rawInput: {
  agentSessionId: string
  type: AgentActivity['type']
  body: string
  signal?: string | null
  signalMetadata?: Record<string, unknown> | null
}): AgentActivity {
  requireSession(rawInput.agentSessionId)
  const input = AgentActivityInputSchema.parse(rawInput)
  return db().insert(agentActivities).values({
    id: randomUUID(),
    agentSessionId: input.agentSessionId,
    type: input.type,
    content: JSON.stringify({ body: input.body }),
    signal: input.signal,
    signalMetadata: input.signalMetadata ? JSON.stringify(input.signalMetadata) : null,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}
