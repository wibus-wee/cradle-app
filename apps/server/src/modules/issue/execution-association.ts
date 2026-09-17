import { AppError } from '../../errors/app-error'
import * as SessionAssociation from '../session/issue-association'
import { getIssue } from './service'

/**
 * Issue-owned workflow for the Issue–execution association.
 *
 * Issue owns the association semantics: the shared-workspace invariant and
 * the link/unlink/relink orchestration. Execution participants (Session,
 * Session Group) own reads and writes of their own `linkedIssueId` column
 * through narrow commands (`readIssueAssociationState`, `writeLinkedIssue`,
 * create/update gates), so this module never touches participant tables.
 *
 * Invariant: a non-null `linkedIssueId` is valid only when the participant
 * and the Issue share the same non-null workspace identity. Rejections throw
 * a single stable `issue_workspace_mismatch` AppError before any write, so a
 * rejected association leaves the previous state unchanged.
 */

export type IssueExecutionParticipantKind = 'session' | 'session-group'

export interface IssueExecutionAssociationTransition {
  participantKind: IssueExecutionParticipantKind
  participantId: string
  previousIssueId: string | null
  nextIssueId: string | null
}

/** The shared workspace invariant for every association entry point. */
export function assertExecutionIssueWorkspaceMatch(input: {
  issueId: string
  participantKind: IssueExecutionParticipantKind
  participantWorkspaceId: string | null
}): void {
  const issue = getIssue(input.issueId)
  if (
    input.participantWorkspaceId === null
    || input.participantWorkspaceId !== issue.workspaceId
  ) {
    throw new AppError({
      code: 'issue_workspace_mismatch',
      status: 409,
      message: 'Issue and execution must belong to the same workspace',
      details: {
        issueId: input.issueId,
        issueWorkspaceId: issue.workspaceId,
        participantKind: input.participantKind,
        participantWorkspaceId: input.participantWorkspaceId,
      },
    })
  }
}

/** Gate registered by the composition root into the Session module. */
export function assertSessionLinkedIssue(input: {
  issueId: string
  workspaceId: string | null
}): void {
  assertExecutionIssueWorkspaceMatch({
    issueId: input.issueId,
    participantKind: 'session',
    participantWorkspaceId: input.workspaceId,
  })
}

/** Gate registered by the composition root into the Session Group module. */
export function assertSessionGroupLinkedIssue(input: {
  issueId: string
  workspaceId: string
}): void {
  assertExecutionIssueWorkspaceMatch({
    issueId: input.issueId,
    participantKind: 'session-group',
    participantWorkspaceId: input.workspaceId,
  })
}

/** Read the current linked Issue for a Session. */
export function getSessionLinkedIssue(sessionId: string): { issueId: string | null } {
  return { issueId: SessionAssociation.readIssueAssociationState(sessionId).linkedIssueId }
}

/** Link or relink a Session to an Issue; returns the typed transition. */
export function linkIssueToSession(
  sessionId: string,
  issueId: string,
): IssueExecutionAssociationTransition {
  const issue = getIssue(issueId)
  const state = SessionAssociation.readIssueAssociationState(sessionId)
  assertExecutionIssueWorkspaceMatch({
    issueId: issue.id,
    participantKind: 'session',
    participantWorkspaceId: state.workspaceId,
  })
  SessionAssociation.writeLinkedIssue({ sessionId, issueId: issue.id })
  return {
    participantKind: 'session',
    participantId: sessionId,
    previousIssueId: state.linkedIssueId,
    nextIssueId: issue.id,
  }
}

/** Unlink a Session from its Issue; returns the typed transition. */
export function unlinkIssueFromSession(sessionId: string): IssueExecutionAssociationTransition {
  const state = SessionAssociation.readIssueAssociationState(sessionId)
  SessionAssociation.writeLinkedIssue({ sessionId, issueId: null })
  return {
    participantKind: 'session',
    participantId: sessionId,
    previousIssueId: state.linkedIssueId,
    nextIssueId: null,
  }
}
