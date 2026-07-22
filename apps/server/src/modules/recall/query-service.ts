import { recallMessages, recallRuns, recallToolEvents, sessions } from '@cradle/db'
import { and, asc, desc, eq, like, or } from 'drizzle-orm'

import { db } from '../../infra'
import { searchChronicle } from '../search/chronicle-search.engine'

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 50
const MAX_CONTEXT_NEIGHBORS = 6

export interface RecallScope {
  workspaceId: string
  sessionId?: string
}

export interface RecallSearchHit {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  excerpt: string
  occurredAt: number
}

export interface RecallToolEventHit {
  id: string
  runId: string | null
  sessionId: string
  toolCallId: string | null
  toolName: string | null
  phase: string
  summary: string
  occurredAt: number
}

function limit(value: number | undefined): number {
  return Math.min(Math.max(value ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
}

function messageConditions(
  scope: RecallScope,
  options: { includeSidechains?: boolean, includeMeta?: boolean } = {},
) {
  return [
    eq(recallMessages.workspaceId, scope.workspaceId),
    scope.sessionId ? eq(recallMessages.sessionId, scope.sessionId) : undefined,
    options.includeSidechains ? undefined : eq(recallMessages.isSidechain, 0),
    options.includeMeta ? undefined : eq(recallMessages.isMeta, 0),
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined)
}

export function overview(scope: RecallScope, options: { limit?: number } = {}) {
  const d = db()
  const sessionLimit = limit(options.limit)
  const sessionRows = d
    .select({
      id: sessions.id,
      title: sessions.title,
      updatedAt: sessions.updatedAt,
      origin: sessions.origin,
      archivedAt: sessions.archivedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspaceId, scope.workspaceId),
        scope.sessionId ? eq(sessions.id, scope.sessionId) : undefined,
      ),
    )
    .orderBy(desc(sessions.updatedAt))
    .limit(sessionLimit)
    .all()

  return {
    workspace: { id: scope.workspaceId },
    currentSessionId: scope.sessionId ?? null,
    sessions: sessionRows,
  }
}

export function search(
  scope: RecallScope,
  text: string,
  options: { limit?: number, includeSidechains?: boolean, includeMeta?: boolean } = {},
): RecallSearchHit[] {
  const query = text.trim()
  if (!query) {
    return []
  }

  const rows = db()
    .select({
      id: recallMessages.messageId,
      sessionId: recallMessages.sessionId,
      role: recallMessages.role,
      excerpt: recallMessages.excerpt,
      occurredAt: recallMessages.occurredAt,
    })
    .from(recallMessages)
    .where(
      and(
        ...messageConditions(scope, options),
        like(recallMessages.excerpt, `%${escapeLike(query)}%`),
      ),
    )
    .orderBy(desc(recallMessages.occurredAt))
    .limit(limit(options.limit))
    .all()

  return rows
}

export function context(scope: RecallScope, messageId: string) {
  const d = db()
  const message = d
    .select({
      id: recallMessages.messageId,
      sessionId: recallMessages.sessionId,
      role: recallMessages.role,
      excerpt: recallMessages.excerpt,
      occurredAt: recallMessages.occurredAt,
    })
    .from(recallMessages)
    .where(and(eq(recallMessages.messageId, messageId), ...messageConditions(scope)))
    .get()
  if (!message) {
    return null
  }

  const neighbors = d
    .select({
      id: recallMessages.messageId,
      sessionId: recallMessages.sessionId,
      role: recallMessages.role,
      excerpt: recallMessages.excerpt,
      occurredAt: recallMessages.occurredAt,
    })
    .from(recallMessages)
    .where(
      and(
        eq(recallMessages.workspaceId, scope.workspaceId),
        eq(recallMessages.sessionId, message.sessionId),
        eq(recallMessages.isSidechain, 0),
        eq(recallMessages.isMeta, 0),
      ),
    )
    .orderBy(asc(recallMessages.occurredAt))
    .all()

  const index = neighbors.findIndex(neighbor => neighbor.id === message.id)
  const start = Math.max(index - MAX_CONTEXT_NEIGHBORS, 0)
  return {
    message,
    neighbors: neighbors.slice(start, index + MAX_CONTEXT_NEIGHBORS + 1),
  }
}

export function thread(
  scope: RecallScope,
  sessionId: string,
  options: { limit?: number, includeSidechains?: boolean } = {},
) {
  if (scope.sessionId && scope.sessionId !== sessionId) {
    return []
  }
  return db()
    .select({
      id: recallMessages.messageId,
      sessionId: recallMessages.sessionId,
      role: recallMessages.role,
      excerpt: recallMessages.excerpt,
      occurredAt: recallMessages.occurredAt,
    })
    .from(recallMessages)
    .where(and(...messageConditions({ ...scope, sessionId }, options)))
    .orderBy(asc(recallMessages.occurredAt))
    .limit(limit(options.limit))
    .all()
}

export function runs(scope: RecallScope, options: { limit?: number } = {}) {
  return db()
    .select({
      id: recallRuns.runId,
      sessionId: recallRuns.sessionId,
      status: recallRuns.status,
      stopReason: recallRuns.stopReason,
      errorText: recallRuns.errorText,
      startedAt: recallRuns.startedAt,
      finishedAt: recallRuns.finishedAt,
    })
    .from(recallRuns)
    .where(
      and(
        eq(recallRuns.workspaceId, scope.workspaceId),
        scope.sessionId ? eq(recallRuns.sessionId, scope.sessionId) : undefined,
      ),
    )
    .orderBy(desc(recallRuns.startedAt))
    .limit(limit(options.limit))
    .all()
}

export function failures(
  scope: RecallScope,
  options: { limit?: number } = {},
): RecallToolEventHit[] {
  return db()
    .select({
      id: recallToolEvents.id,
      runId: recallToolEvents.runId,
      sessionId: recallToolEvents.sessionId,
      toolCallId: recallToolEvents.toolCallId,
      toolName: recallToolEvents.toolName,
      phase: recallToolEvents.phase,
      summary: recallToolEvents.summary,
      occurredAt: recallToolEvents.occurredAt,
    })
    .from(recallToolEvents)
    .where(
      and(
        eq(recallToolEvents.workspaceId, scope.workspaceId),
        eq(recallToolEvents.isFailure, 1),
        scope.sessionId ? eq(recallToolEvents.sessionId, scope.sessionId) : undefined,
      ),
    )
    .orderBy(desc(recallToolEvents.occurredAt))
    .limit(limit(options.limit))
    .all()
}

export function fileHistory(
  scope: RecallScope,
  path: string,
  options: { limit?: number } = {},
): RecallToolEventHit[] {
  const query = path.trim()
  if (!query) {
    return []
  }
  return db()
    .select({
      id: recallToolEvents.id,
      runId: recallToolEvents.runId,
      sessionId: recallToolEvents.sessionId,
      toolCallId: recallToolEvents.toolCallId,
      toolName: recallToolEvents.toolName,
      phase: recallToolEvents.phase,
      summary: recallToolEvents.summary,
      occurredAt: recallToolEvents.occurredAt,
    })
    .from(recallToolEvents)
    .where(
      and(
        eq(recallToolEvents.workspaceId, scope.workspaceId),
        scope.sessionId ? eq(recallToolEvents.sessionId, scope.sessionId) : undefined,
        or(
          like(recallToolEvents.summary, `%${escapeLike(query)}%`),
          like(recallToolEvents.toolName, '%file%'),
        ),
      ),
    )
    .orderBy(desc(recallToolEvents.occurredAt))
    .limit(limit(options.limit))
    .all()
}

export function memories(scope: RecallScope, options: { query?: string, limit?: number } = {}) {
  const query = options.query?.trim()
  if (!query) {
    return []
  }
  return searchChronicle({
    query,
    workspaceId: scope.workspaceId,
    limit: limit(options.limit),
  }).map(memory => ({
    id: memory.id,
    type: memory.type,
    summary: memory.snippet.text,
    updatedAt: memory.updatedAt,
  }))
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
