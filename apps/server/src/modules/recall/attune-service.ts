import { randomUUID } from 'node:crypto'

import { recallAttunementRequests, recallAttunements, recallFileTouches, recallMessages, recallToolEvents } from '@cradle/db'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { RecallAttuneIntent } from './attune-evaluator'
import type { RecallInvocationContext } from './evaluator'

export function remember(input: {
  context: RecallInvocationContext
  content: string
  evidenceIds: string[]
}) {
  const content = input.content.trim()
  const evidenceIds = [...new Set(input.evidenceIds.map(id => id.trim()).filter(Boolean))]
  if (!content) {
    throw new AppError({
      code: 'recall_attune_content_required',
      status: 400,
      message: 'Attune content is required.',
    })
  }
  if (evidenceIds.length === 0) {
    throw new AppError({
      code: 'recall_attune_evidence_required',
      status: 400,
      message: 'Attune requires at least one evidence ID.',
    })
  }
  assertEvidenceIds(input.context, evidenceIds)
  const now = Math.floor(Date.now() / 1000)
  const row = {
    id: randomUUID(),
    workspaceId: input.context.workspaceId,
    sessionId: input.context.chatSessionId,
    content,
    evidenceIdsJson: JSON.stringify(evidenceIds),
    status: 'active' as const,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  db().insert(recallAttunements).values(row).run()
  return row
}

export function requestAttunement(input: {
  context: RecallInvocationContext
  intent: RecallAttuneIntent
}) {
  if (input.intent.operation === 'remember') {
    const content = input.intent.content.trim()
    const evidenceIds = normalizeEvidenceIds(input.intent.evidenceIds)
    if (!content || evidenceIds.length === 0) {
      throw new AppError({ code: 'recall_attune_invalid_request', status: 400, message: 'Remember requires content and evidence IDs.' })
    }
    assertEvidenceIds(input.context, evidenceIds)
    return insertRequest(input.context, { operation: 'remember', content, evidenceIds })
  }
  assertOwnedAttunement(input.context, input.intent.id)
  return insertRequest(input.context, { operation: 'forget', id: input.intent.id })
}

export function resolveAttunementRequest(input: {
  context: RecallInvocationContext
  requestId: string
  approved: boolean
}) {
  const request = db().select().from(recallAttunementRequests).where(and(
    eq(recallAttunementRequests.id, input.requestId),
    eq(recallAttunementRequests.workspaceId, input.context.workspaceId),
    eq(recallAttunementRequests.sessionId, input.context.chatSessionId),
  )).get()
  if (!request || request.status !== 'pending') {
    throw new AppError({ code: 'recall_attune_request_not_found', status: 404, message: 'Pending attune request was not found.' })
  }
  const now = Math.floor(Date.now() / 1000)
  if (!input.approved) {
    db().update(recallAttunementRequests).set({ status: 'denied', resolvedAt: now, updatedAt: now }).where(eq(recallAttunementRequests.id, request.id)).run()
    return { ...request, status: 'denied' as const, resolvedAt: now, updatedAt: now }
  }
  const evidenceIds = readEvidenceIds(request.evidenceIdsJson)
  const result = request.operation === 'remember'
    ? remember({ context: input.context, content: request.content ?? '', evidenceIds })
    : forget({ context: input.context, id: request.attunementId ?? '' })
  db().update(recallAttunementRequests).set({ status: 'executed', resolvedAt: now, executedAt: now, updatedAt: now }).where(eq(recallAttunementRequests.id, request.id)).run()
  return { requestId: request.id, status: 'executed' as const, result }
}

export function listPendingAttunementRequests(context: RecallInvocationContext) {
  return db().select().from(recallAttunementRequests).where(and(
    eq(recallAttunementRequests.workspaceId, context.workspaceId),
    eq(recallAttunementRequests.sessionId, context.chatSessionId),
    eq(recallAttunementRequests.status, 'pending'),
  )).orderBy(desc(recallAttunementRequests.updatedAt)).all()
}

export function forget(input: { context: RecallInvocationContext, id: string }) {
  const existing = db()
    .select()
    .from(recallAttunements)
    .where(
      and(
        eq(recallAttunements.id, input.id),
        eq(recallAttunements.workspaceId, input.context.workspaceId),
      ),
    )
    .get()
  if (!existing) {
    throw new AppError({
      code: 'recall_attune_not_found',
      status: 404,
      message: 'Attune record was not found.',
    })
  }
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(recallAttunements)
    .set({ status: 'archived', archivedAt: now, updatedAt: now })
    .where(eq(recallAttunements.id, existing.id))
    .run()
  return { ...existing, status: 'archived' as const, archivedAt: now, updatedAt: now }
}

export function listAttunements(context: RecallInvocationContext, limit = 20) {
  return db()
    .select()
    .from(recallAttunements)
    .where(
      and(
        eq(recallAttunements.workspaceId, context.workspaceId),
        eq(recallAttunements.status, 'active'),
      ),
    )
    .orderBy(desc(recallAttunements.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 50))
    .all()
}

function insertRequest(context: RecallInvocationContext, input: { operation: 'remember', content: string, evidenceIds: string[] } | { operation: 'forget', id: string }) {
  const now = Math.floor(Date.now() / 1000)
  const row = {
    id: randomUUID(),
workspaceId: context.workspaceId,
sessionId: context.chatSessionId,
    operation: input.operation,
content: input.operation === 'remember' ? input.content : null,
    evidenceIdsJson: JSON.stringify(input.operation === 'remember' ? input.evidenceIds : []),
    attunementId: input.operation === 'forget' ? input.id : null,
    status: 'pending' as const,
resolvedAt: null,
executedAt: null,
createdAt: now,
updatedAt: now,
  }
  db().insert(recallAttunementRequests).values(row).run()
  return row
}

function normalizeEvidenceIds(ids: string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))]
}

function assertEvidenceIds(context: RecallInvocationContext, ids: string[]): void {
  const found = new Set<string>()
  db().select({ id: recallMessages.messageId }).from(recallMessages).where(and(
    eq(recallMessages.workspaceId, context.workspaceId),
    inArray(recallMessages.messageId, ids),
  )).all().forEach(row => found.add(row.id))
  db().select({ id: recallToolEvents.id }).from(recallToolEvents).where(and(
    eq(recallToolEvents.workspaceId, context.workspaceId),
    inArray(recallToolEvents.id, ids),
  )).all().forEach(row => found.add(row.id))
  db().select({ id: recallFileTouches.id }).from(recallFileTouches).where(and(
    eq(recallFileTouches.workspaceId, context.workspaceId),
    inArray(recallFileTouches.id, ids),
  )).all().forEach(row => found.add(row.id))
  const missing = ids.filter(id => !found.has(id))
  if (missing.length > 0) {
    throw new AppError({ code: 'recall_attune_evidence_not_found', status: 400, message: 'Attune evidence must belong to the current workspace.', details: { missing } })
  }
}

function assertOwnedAttunement(context: RecallInvocationContext, id: string) {
  const row = db().select({ id: recallAttunements.id }).from(recallAttunements).where(and(eq(recallAttunements.id, id), eq(recallAttunements.workspaceId, context.workspaceId))).get()
  if (!row) { throw new AppError({ code: 'recall_attune_not_found', status: 404, message: 'Attune record was not found.' }) }
}

function readEvidenceIds(raw: string): string[] {
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [] }
  catch { return [] }
}
