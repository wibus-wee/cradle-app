import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'

/**
 * Session-owned seam for the Issue–execution association workflow.
 *
 * Session owns reads and writes of `sessions.linkedIssueId`; the Issue
 * module owns the association workflow and the shared-workspace invariant.
 * Session never imports Issue — the composition root registers the Issue
 * validator through `registerLinkedIssueValidator`, and every entry point
 * that persists a non-null `linkedIssueId` (create-with-link, direct
 * link/relink, node-projection attach) passes through `assertLinkedIssue`.
 */

export interface SessionIssueAssociationState {
  sessionId: string
  workspaceId: string | null
  linkedIssueId: string | null
}

/** Issue-owned invariant validator injected by the composition root. */
export type SessionLinkedIssueValidator = (input: {
  issueId: string
  workspaceId: string | null
}) => void

let linkedIssueValidator: SessionLinkedIssueValidator | null = null

export function registerLinkedIssueValidator(validator: SessionLinkedIssueValidator | null): void {
  linkedIssueValidator = validator
}

/**
 * Run the Issue-owned association invariant for a candidate link. Fails
 * closed when no validator is registered so the invariant cannot be bypassed.
 */
export function assertLinkedIssue(input: {
  issueId: string
  workspaceId: string | null
}): void {
  if (!linkedIssueValidator) {
    throw new AppError({
      code: 'issue_link_validation_unavailable',
      status: 500,
      message: 'Issue link validation is not registered.',
      details: { issueId: input.issueId },
    })
  }
  linkedIssueValidator(input)
}

/** Read the participant workspace and current Issue association. */
export function readIssueAssociationState(sessionId: string): SessionIssueAssociationState {
  const row = db()
    .select({
      workspaceId: sessions.workspaceId,
      linkedIssueId: sessions.linkedIssueId,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
  if (!row) {
    throw new AppError({
      code: 'session_not_found',
      status: 404,
      message: 'Session not found',
      details: { sessionId },
    })
  }
  return { sessionId, workspaceId: row.workspaceId, linkedIssueId: row.linkedIssueId }
}

/**
 * Write `sessions.linkedIssueId`. This is the only write path for the
 * column; the caller is the Issue-owned association workflow or a
 * create-with-link entry point that already ran `assertLinkedIssue`.
 * Returns the state after the write.
 */
export function writeLinkedIssue(input: {
  sessionId: string
  issueId: string | null
}): SessionIssueAssociationState {
  const previous = readIssueAssociationState(input.sessionId)
  db()
    .update(sessions)
    .set({ linkedIssueId: input.issueId })
    .where(eq(sessions.id, input.sessionId))
    .run()
  return { ...previous, linkedIssueId: input.issueId }
}
