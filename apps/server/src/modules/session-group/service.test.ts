import { randomUUID } from 'node:crypto'

import { sessionGroups, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { localWorkspaceLocatorJson } from '../../../tests/helpers/workspace-fixture'
import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
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
