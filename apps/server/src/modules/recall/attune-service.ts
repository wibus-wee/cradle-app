import { randomUUID } from 'node:crypto'

import { recallAttunements } from '@cradle/db'
import { and, desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
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
