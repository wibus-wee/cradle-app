import { randomUUID } from 'node:crypto'

import type { SessionGroup } from '@cradle/db'
import { messages, sessionGroups, sessions } from '@cradle/db'
import { and, desc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as Issue from '../issue/service'
import type { SessionStatus, SessionView } from '../session/service'
import {
  aggregateSessionStatus,
  listBySessionGroupId,
} from '../session/service'
import * as Workspace from '../workspace/service'

export type SessionGroupStatus = 'active' | 'archived'
export type SessionGroupAggregateStatus = SessionStatus

export interface SessionGroupMemberSummary {
  id: string
  title: string | null
  status: SessionStatus
  latestUserMessageAt: number | null
}

export interface SessionGroupView {
  id: string
  workspaceId: string
  title: string
  description: string | null
  linkedIssueId: string | null
  status: SessionGroupStatus
  configJson: string
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  sessionCount: number
  statusAggregate: SessionGroupAggregateStatus
  latestActivityAt: number | null
}

export interface SessionGroupDetailView extends SessionGroupView {
  sessions: SessionGroupMemberSummary[]
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function getGroupRow(id: string): SessionGroup | null {
  return db().select().from(sessionGroups).where(eq(sessionGroups.id, id)).get() ?? null
}

function assertGroupExists(id: string): SessionGroup {
  const group = getGroupRow(id)
  if (!group) {
    throw new AppError({
      code: 'session_group_not_found',
      status: 404,
      message: 'Session group not found',
      details: { id },
    })
  }
  return group
}

function readMemberSessionIds(groupId: string, includeArchived = false): string[] {
  const predicates = [eq(sessions.sessionGroupId, groupId)]
  if (!includeArchived) {
    predicates.push(isNull(sessions.archivedAt))
  }
  return db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(...predicates))
    .all()
    .map(row => row.id)
}

function readLatestActivityAtBySessionIds(sessionIds: string[]): number | null {
  if (sessionIds.length === 0) {
    return null
  }

  const rows = db()
    .select({
      sessionId: messages.sessionId,
      latestUserMessageAt: max(messages.createdAt).as('latest_user_message_at'),
    })
    .from(messages)
    .where(and(inArray(messages.sessionId, sessionIds), eq(messages.role, 'user')))
    .groupBy(messages.sessionId)
    .all()

  const activityTimes = rows
    .map(row => row.latestUserMessageAt)
    .filter((value): value is number => value !== null && value !== undefined)

  if (activityTimes.length === 0) {
    const createdRows = db()
      .select({ createdAt: sessions.createdAt })
      .from(sessions)
      .where(inArray(sessions.id, sessionIds))
      .all()
    if (createdRows.length === 0) {
      return null
    }
    return Math.max(...createdRows.map(row => row.createdAt))
  }

  return Math.max(...activityTimes)
}

function toMemberSummaries(memberSessions: SessionView[]): SessionGroupMemberSummary[] {
  return memberSessions.map(session => ({
    id: session.id,
    title: session.title,
    status: session.status,
    latestUserMessageAt: session.latestUserMessageAt,
  }))
}

function toSessionGroupView(group: SessionGroup, memberSessionIds: string[]): SessionGroupView {
  return {
    id: group.id,
    workspaceId: group.workspaceId,
    title: group.title,
    description: group.description,
    linkedIssueId: group.linkedIssueId,
    status: group.status,
    configJson: group.configJson,
    archivedAt: group.archivedAt,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    sessionCount: memberSessionIds.length,
    statusAggregate: aggregateSessionStatus(memberSessionIds),
    latestActivityAt: readLatestActivityAtBySessionIds(memberSessionIds),
  }
}

export function assertSessionBelongsToGroupWorkspace(input: {
  sessionId: string
  groupId: string
}): void {
  const group = assertGroupExists(input.groupId)
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'session_not_found',
      status: 404,
      message: 'Session not found',
      details: { sessionId: input.sessionId },
    })
  }
  if (session.workspaceId !== group.workspaceId) {
    throw new AppError({
      code: 'session_group_workspace_mismatch',
      status: 409,
      message: 'Session workspace does not match session group workspace',
      details: {
        sessionId: input.sessionId,
        sessionWorkspaceId: session.workspaceId,
        groupId: input.groupId,
        groupWorkspaceId: group.workspaceId,
      },
    })
  }
}

function assignSessionsToGroup(groupId: string, sessionIds: string[]): void {
  const uniqueSessionIds = [...new Set(sessionIds)]
  if (uniqueSessionIds.length === 0) {
    return
  }

  for (const sessionId of uniqueSessionIds) {
    assertSessionBelongsToGroupWorkspace({ sessionId, groupId })
  }

  const now = currentUnixSeconds()
  db()
    .update(sessions)
    .set({ sessionGroupId: groupId, updatedAt: now })
    .where(inArray(sessions.id, uniqueSessionIds))
    .run()
}

export function list(input: {
  workspaceId?: string
  linkedIssueId?: string
  archived?: boolean
} = {}): SessionGroupView[] {
  const predicates = [
    input.workspaceId ? eq(sessionGroups.workspaceId, input.workspaceId) : undefined,
    input.linkedIssueId ? eq(sessionGroups.linkedIssueId, input.linkedIssueId) : undefined,
    input.archived ? isNotNull(sessionGroups.archivedAt) : isNull(sessionGroups.archivedAt),
  ].filter(predicate => predicate !== undefined)
  const where = predicates.length > 0 ? and(...predicates) : undefined

  const query = db()
    .select()
    .from(sessionGroups)
    .orderBy(desc(sessionGroups.updatedAt), desc(sessionGroups.createdAt))

  const rows = where ? query.where(where).all() : query.all()
  return rows.map(group => toSessionGroupView(group, readMemberSessionIds(group.id)))
}

export function get(id: string): SessionGroupDetailView | null {
  const group = getGroupRow(id)
  if (!group) {
    return null
  }

  const memberSessions = listBySessionGroupId(group.id)
  const memberSessionIds = memberSessions.map(session => session.id)
  return {
    ...toSessionGroupView(group, memberSessionIds),
    sessions: toMemberSummaries(memberSessions),
  }
}

export function create(input: {
  workspaceId: string
  title: string
  description?: string | null
  linkedIssueId?: string | null
  sessionIds?: string[]
}): SessionGroupDetailView {
  if (!Workspace.get(input.workspaceId)) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId: input.workspaceId },
    })
  }

  if (input.linkedIssueId) {
    Issue.getIssue(input.linkedIssueId)
  }

  const now = currentUnixSeconds()
  const group = db()
    .insert(sessionGroups)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      linkedIssueId: input.linkedIssueId ?? null,
      status: 'active',
      configJson: '{}',
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  if (input.sessionIds && input.sessionIds.length > 0) {
    assignSessionsToGroup(group.id, input.sessionIds)
  }

  return get(group.id)!
}

export function update(input: {
  id: string
  title?: string
  description?: string | null
  linkedIssueId?: string | null
  archived?: boolean
}): SessionGroupDetailView | null {
  const group = getGroupRow(input.id)
  if (!group) {
    return null
  }

  if (input.linkedIssueId) {
    Issue.getIssue(input.linkedIssueId)
  }

  const now = currentUnixSeconds()
  const patch: Partial<typeof sessionGroups.$inferInsert> = { updatedAt: now }

  if (input.title !== undefined) {
    patch.title = input.title.trim()
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null
  }
  if (input.linkedIssueId !== undefined) {
    patch.linkedIssueId = input.linkedIssueId
  }
  if (input.archived !== undefined) {
    patch.status = input.archived ? 'archived' : 'active'
    patch.archivedAt = input.archived ? now : null
  }

  db().update(sessionGroups).set(patch).where(eq(sessionGroups.id, input.id)).run()
  return get(input.id)
}

export function remove(id: string): void {
  assertGroupExists(id)
  const now = currentUnixSeconds()
  db()
    .update(sessions)
    .set({ sessionGroupId: null, updatedAt: now })
    .where(eq(sessions.sessionGroupId, id))
    .run()
  db().delete(sessionGroups).where(eq(sessionGroups.id, id)).run()
}

export function addMembers(groupId: string, sessionIds: string[]): SessionGroupDetailView {
  assertGroupExists(groupId)
  assignSessionsToGroup(groupId, sessionIds)
  db()
    .update(sessionGroups)
    .set({ updatedAt: currentUnixSeconds() })
    .where(eq(sessionGroups.id, groupId))
    .run()
  return get(groupId)!
}

export function removeMember(groupId: string, sessionId: string): SessionGroupDetailView | null {
  assertGroupExists(groupId)
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'session_not_found',
      status: 404,
      message: 'Session not found',
      details: { sessionId },
    })
  }
  if (session.sessionGroupId !== groupId) {
    throw new AppError({
      code: 'session_group_member_not_found',
      status: 404,
      message: 'Session is not a member of this group',
      details: { groupId, sessionId },
    })
  }

  const now = currentUnixSeconds()
  db()
    .update(sessions)
    .set({ sessionGroupId: null, updatedAt: now })
    .where(eq(sessions.id, sessionId))
    .run()
  db()
    .update(sessionGroups)
    .set({ updatedAt: now })
    .where(eq(sessionGroups.id, groupId))
    .run()

  return get(groupId)
}

export function listByLinkedIssue(issueId: string): SessionGroupView[] {
  Issue.getIssue(issueId)
  return list({ linkedIssueId: issueId, archived: false })
}
