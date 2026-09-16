import { randomUUID } from 'node:crypto'

import { issues, sessionGroups, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { localWorkspaceLocatorJson } from '../../../tests/helpers/workspace-fixture'
import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as IssueAssociation from '../issue/execution-association'
import * as Issue from '../issue/service'
import * as SessionGroup from './service'

const WORKSPACE_ID = 'workspace-session-group-test'

function seedWorkspace(id = WORKSPACE_ID): void {
  db().insert(workspaces).values({
    id,
    name: 'Session Group Test Workspace',
    locatorJson: localWorkspaceLocatorJson('/tmp/session-group-test'),
    identifier: 'SGT',
  }).run()
}

function seedSession(input: {
  id: string
  title: string
  sessionGroupId?: string | null
}): void {
  db().insert(sessions).values({
    id: input.id,
    workspaceId: WORKSPACE_ID,
    title: input.title,
    sessionGroupId: input.sessionGroupId ?? null,
  }).run()
}

afterEach(() => {
  db().delete(sessions).run()
  db().delete(sessionGroups).run()
  db().delete(workspaces).run()
})

describe('session-group service', () => {
  it('creates a group and assigns sessions from the same workspace', () => {
    seedWorkspace()
    seedSession({ id: 'session-a', title: 'Session A' })
    seedSession({ id: 'session-b', title: 'Session B' })

    const group = SessionGroup.create({
      workspaceId: WORKSPACE_ID,
      title: 'Auth work pack',
      sessionIds: ['session-a', 'session-b'],
    })

    expect(group.sessionCount).toBe(2)
    expect(group.sessions.map(session => session.id).sort()).toEqual(['session-a', 'session-b'])

    const rows = db().select().from(sessions).all()
    expect(rows.every(row => row.sessionGroupId === group.id)).toBe(true)
  })

  it('rejects assigning a session from a different workspace', () => {
    seedWorkspace()
    const otherWorkspaceId = randomUUID()
    db().insert(workspaces).values({
      id: otherWorkspaceId,
      name: 'Other Workspace',
      locatorJson: localWorkspaceLocatorJson('/tmp/other'),
      identifier: 'OTH',
    }).run()

    const group = SessionGroup.create({
      workspaceId: WORKSPACE_ID,
      title: 'Pack',
    })
    seedSession({ id: 'foreign-session', title: 'Foreign' })
    db().update(sessions).set({ workspaceId: otherWorkspaceId }).where(eq(sessions.id, 'foreign-session')).run()

    expect(() => SessionGroup.addMembers(group.id, ['foreign-session'])).toThrow(AppError)
  })

  it('unbinds members when deleting a group', () => {
    seedWorkspace()
    seedSession({ id: 'session-a', title: 'Session A' })
    const group = SessionGroup.create({
      workspaceId: WORKSPACE_ID,
      title: 'Pack',
      sessionIds: ['session-a'],
    })

    SessionGroup.remove(group.id)

    const session = db().select().from(sessions).where(eq(sessions.id, 'session-a')).get()
    expect(session?.sessionGroupId).toBeNull()
    expect(db().select().from(sessionGroups).all()).toHaveLength(0)
  })
})

describe('session-group issue association', () => {
  const OTHER_WORKSPACE_ID = 'workspace-session-group-other'

  beforeEach(() => {
    // Register the Issue-owned invariant validator — the same gate the
    // composition root wires in app.ts.
    SessionGroup.registerLinkedIssueValidator(IssueAssociation.assertSessionGroupLinkedIssue)
  })

  afterEach(() => {
    db().delete(issues).run()
  })

  function seedOtherWorkspace(): void {
    db().insert(workspaces).values({
      id: OTHER_WORKSPACE_ID,
      name: 'Other Workspace',
      locatorJson: localWorkspaceLocatorJson('/tmp/session-group-other'),
      identifier: 'OTH',
    }).run()
  }

  function seedIssue(workspaceId: string, title: string): string {
    return Issue.createIssue({ workspaceId, title }).id
  }

  it('creates a group linked to an issue in the same workspace', () => {
    seedWorkspace()
    const issueId = seedIssue(WORKSPACE_ID, 'Linked issue')

    const group = SessionGroup.create({
      workspaceId: WORKSPACE_ID,
      title: 'Linked group',
      linkedIssueId: issueId,
    })

    expect(group.linkedIssueId).toBe(issueId)
  })

  it('rejects create-with-link across workspaces without leaving a group row', () => {
    seedWorkspace()
    seedOtherWorkspace()
    const otherIssueId = seedIssue(OTHER_WORKSPACE_ID, 'Other workspace issue')

    expect(() => SessionGroup.create({
      workspaceId: WORKSPACE_ID,
      title: 'Cross-workspace group',
      linkedIssueId: otherIssueId,
    })).toThrowError(expect.objectContaining({ code: 'issue_workspace_mismatch', status: 409 }))
    expect(db().select().from(sessionGroups).all()).toHaveLength(0)
  })

  it('returns the association transition for link, relink, and unlink updates', () => {
    seedWorkspace()
    const issueA = seedIssue(WORKSPACE_ID, 'Issue A')
    const issueB = seedIssue(WORKSPACE_ID, 'Issue B')
    const group = SessionGroup.create({ workspaceId: WORKSPACE_ID, title: 'Group' })

    const linked = SessionGroup.update({ id: group.id, linkedIssueId: issueA })
    expect(linked?.association).toEqual({
      participantKind: 'session-group',
      participantId: group.id,
      previousIssueId: null,
      nextIssueId: issueA,
    })
    expect(linked?.group.linkedIssueId).toBe(issueA)

    const relinked = SessionGroup.update({ id: group.id, linkedIssueId: issueB })
    expect(relinked?.association).toEqual({
      participantKind: 'session-group',
      participantId: group.id,
      previousIssueId: issueA,
      nextIssueId: issueB,
    })

    const unlinked = SessionGroup.update({ id: group.id, linkedIssueId: null })
    expect(unlinked?.association).toEqual({
      participantKind: 'session-group',
      participantId: group.id,
      previousIssueId: issueB,
      nextIssueId: null,
    })
    expect(unlinked?.group.linkedIssueId).toBeNull()
  })

  it('returns null association for updates that do not touch linkedIssueId', () => {
    seedWorkspace()
    const group = SessionGroup.create({ workspaceId: WORKSPACE_ID, title: 'Group' })

    const updated = SessionGroup.update({ id: group.id, title: 'Renamed' })

    expect(updated?.association).toBeNull()
    expect(updated?.group.title).toBe('Renamed')
  })

  it('rejects cross-workspace update-with-link and preserves the previous association', () => {
    seedWorkspace()
    seedOtherWorkspace()
    const issueId = seedIssue(WORKSPACE_ID, 'Issue A')
    const otherIssueId = seedIssue(OTHER_WORKSPACE_ID, 'Other workspace issue')
    const group = SessionGroup.create({ workspaceId: WORKSPACE_ID, title: 'Group', linkedIssueId: issueId })

    expect(() => SessionGroup.update({ id: group.id, linkedIssueId: otherIssueId }))
      .toThrowError(expect.objectContaining({ code: 'issue_workspace_mismatch', status: 409 }))
    expect(SessionGroup.get(group.id)?.linkedIssueId).toBe(issueId)
  })

  it('rejects update-with-link for a missing issue', () => {
    seedWorkspace()
    const group = SessionGroup.create({ workspaceId: WORKSPACE_ID, title: 'Group' })

    expect(() => SessionGroup.update({ id: group.id, linkedIssueId: 'missing-issue' }))
      .toThrowError(expect.objectContaining({ code: 'issue_not_found', status: 404 }))
    expect(SessionGroup.get(group.id)?.linkedIssueId).toBeNull()
  })
})
