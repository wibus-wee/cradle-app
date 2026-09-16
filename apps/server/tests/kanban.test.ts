import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agents, providerTargets, sessions, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { workspaceFixture } from './helpers/workspace-fixture'

interface KanbanStatus {
  id: string
  name: string
  workspaceId: string
}

interface KanbanBoard {
  id: string
  name: string
  workspaceId: string
}

interface Issue {
  id: string
  number: number
  title: string
  description: string | null
  workspaceId: string
  statusId: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  createdByKind: 'user' | 'agent' | 'provider-target' | 'system'
  createdById: string
  sourceChatSessionId: string | null
}

interface LinkedSession {
  id: string
  linkedIssueId: string | null
  title: string | null
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('kanban capability', () => {
  it('creates boards, seeds default statuses, and supports the issue/comment core loop', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-kanban',
        name: 'Workspace Kanban',
        identifier: 'KAN',
        path: workspaceRoot,
      })).run()

      const createBoard = await app.handle(new Request('http://localhost/kanban/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-kanban', name: 'Backend Board' }),
      }))
      expect(createBoard.status).toBe(200)
      const board = await createBoard.json() as KanbanBoard
      expect(board).toEqual(expect.objectContaining({ name: 'Backend Board', workspaceId: 'workspace-kanban' }))

      const listBoards = await app.handle(new Request('http://localhost/kanban/boards?workspaceId=workspace-kanban'))
      expect(listBoards.status).toBe(200)
      expect(await listBoards.json()).toEqual([expect.objectContaining({ id: board.id, name: 'Backend Board' })])

      const listStatuses = await app.handle(new Request('http://localhost/issues/statuses?workspaceId=workspace-kanban'))
      expect(listStatuses.status).toBe(200)
      const statuses = await listStatuses.json() as KanbanStatus[]
      expect(statuses.map(status => status.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'Done', 'Canceled'])

      const backlogStatusId = statuses.find(status => status.name === 'Backlog')?.id
      const todoStatusId = statuses.find(status => status.name === 'To Do')?.id
      const inProgressStatusId = statuses.find(status => status.name === 'In Progress')?.id
      expect(backlogStatusId).toBeTruthy()
      expect(todoStatusId).toBeTruthy()
      expect(inProgressStatusId).toBeTruthy()

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue',
          description: 'Issue created from HTTP server',
          priority: 'high',
          statusId: todoStatusId!,
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue
      expect(issue).toEqual(expect.objectContaining({ id: 'KAN-001', number: 1 }))
      expect(issue).toEqual(expect.objectContaining({ title: 'Server issue', statusId: todoStatusId, priority: 'high' }))
      expect(issue).toEqual(expect.objectContaining({ createdByKind: 'user', createdById: '__self__' }))

      const createIssueWithoutStatus = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue without status',
        }),
      }))
      expect(createIssueWithoutStatus.status).toBe(200)
      const issueWithoutStatus = await createIssueWithoutStatus.json() as Issue
      expect(issueWithoutStatus).toEqual(expect.objectContaining({ id: 'KAN-002', number: 2 }))
      expect(issueWithoutStatus).toEqual(expect.objectContaining({ statusId: backlogStatusId }))

      const createIssueWithStatusName = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue with status name',
          statusName: 'to_do',
        }),
      }))
      expect(createIssueWithStatusName.status).toBe(200)
      const issueWithStatusName = await createIssueWithStatusName.json() as Issue
      expect(issueWithStatusName).toEqual(expect.objectContaining({ id: 'KAN-003', number: 3 }))
      expect(issueWithStatusName).toEqual(expect.objectContaining({ statusId: todoStatusId }))

      const createIssueWithConflictingStatusRefs = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue with conflicting status refs',
          statusId: todoStatusId!,
          statusName: 'in_progress',
        }),
      }))
      expect(createIssueWithConflictingStatusRefs.status).toBe(400)

      const updateIssue = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Updated issue', description: 'Updated description' }),
      }))
      expect(updateIssue.status).toBe(200)
      expect(await updateIssue.json()).toEqual(expect.objectContaining({ title: 'Updated issue', description: 'Updated description' }))

      const moveIssue = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId: inProgressStatusId! }),
      }))
      expect(moveIssue.status).toBe(200)
      expect(await moveIssue.json()).toEqual(expect.objectContaining({ statusId: inProgressStatusId }))

      const moveIssueByStatusName = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueWithStatusName.id)}/status/in_progress`, {
        method: 'PATCH',
      }))
      expect(moveIssueByStatusName.status).toBe(200)
      expect(await moveIssueByStatusName.json()).toEqual(expect.objectContaining({ statusId: inProgressStatusId }))

      const listIssues = await app.handle(new Request('http://localhost/issues?workspaceId=workspace-kanban'))
      expect(listIssues.status).toBe(200)
      expect(await listIssues.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: issue.id, statusId: inProgressStatusId }),
        expect.objectContaining({ id: issueWithoutStatus.id, statusId: backlogStatusId }),
        expect.objectContaining({ id: issueWithStatusName.id, statusId: inProgressStatusId }),
      ]))

      const searchByIssueId = await app.handle(new Request('http://localhost/issues/search?q=KAN-001'))
      expect(searchByIssueId.status).toBe(200)
      expect(await searchByIssueId.json()).toEqual([
        expect.objectContaining({ id: issue.id, number: 1 }),
      ])

      const searchByIssueNumber = await app.handle(new Request('http://localhost/issues/search?q=2'))
      expect(searchByIssueNumber.status).toBe(200)
      expect(await searchByIssueNumber.json()).toEqual([
        expect.objectContaining({ id: issueWithoutStatus.id, number: 2 }),
      ])

      db().insert(providerTargets).values({
        id: 'provider-target-linked-session',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Linked Session Provider',
      }).run()
      const createSession = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Linked investigation chat',
          providerTargetId: 'provider-target-linked-session',
        }),
      }))
      expect(createSession.status).toBe(200)
      const session = await createSession.json() as LinkedSession

      const linkSession = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(session.id)}/linked-issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id }),
      }))
      expect(linkSession.status).toBe(200)

      const listLinkedSessions = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/sessions`))
      expect(listLinkedSessions.status).toBe(200)
      expect(await listLinkedSessions.json()).toEqual([
        expect.objectContaining({
          id: session.id,
          title: 'Linked investigation chat',
          linkedIssueId: issue.id,
        }),
      ])

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Looks good to me' }),
      }))
      expect(addComment.status).toBe(200)
      const comment = await addComment.json() as { id: string, content: string, issueId: string, authorKind: string, authorId: string | null, author: { kind: string, id: string | null, displayName: string, label: string | null } }
      expect(comment).toEqual(expect.objectContaining({ issueId: issue.id, content: 'Looks good to me' }))
      expect(comment).toEqual(expect.objectContaining({ authorKind: 'user', authorId: '__self__' }))
      expect(comment.author).toEqual(expect.objectContaining({ kind: 'user', id: '__self__', displayName: 'You', label: null }))

      const listComments = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`))
      expect(listComments.status).toBe(200)
      expect(await listComments.json()).toEqual([expect.objectContaining({ id: comment.id, content: 'Looks good to me' })])

      const deleteComment = await app.handle(new Request(`http://localhost/issues/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' }))
      expect(deleteComment.status).toBe(200)
      expect(await deleteComment.json()).toEqual({ ok: true })

      const deleteIssue = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}`, { method: 'DELETE' }))
      expect(deleteIssue.status).toBe(200)
      expect(await deleteIssue.json()).toEqual({ ok: true })

      const deleteIssueWithoutStatus = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueWithoutStatus.id)}`, { method: 'DELETE' }))
      expect(deleteIssueWithoutStatus.status).toBe(200)
      expect(await deleteIssueWithoutStatus.json()).toEqual({ ok: true })

      const deleteIssueWithStatusName = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueWithStatusName.id)}`, { method: 'DELETE' }))
      expect(deleteIssueWithStatusName.status).toBe(200)
      expect(await deleteIssueWithStatusName.json()).toEqual({ ok: true })

      const issuesAfterDelete = await app.handle(new Request('http://localhost/issues?workspaceId=workspace-kanban'))
      expect(issuesAfterDelete.status).toBe(200)
      expect(await issuesAfterDelete.json()).toEqual([])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('records agent provenance from the chat session runtime context', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-kanban-agent',
        name: 'Workspace Kanban Agent',
        identifier: 'KAG',
        path: workspaceRoot,
      })).run()
      db().insert(providerTargets).values({
        id: 'provider-target-kanban-agent',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Kanban Agent Provider',
      }).run()
      db().insert(agents).values({
        id: 'agent-kanban',
        name: 'Kanban Agent',
        avatarStyle: 'bottts-neutral',
        avatarSeed: 'kanban-agent',
        providerTargetId: 'provider-target-kanban-agent',
      }).run()
      db().insert(sessions).values({
        id: 'chat-session-kanban-agent',
        workspaceId: 'workspace-kanban-agent',
        title: 'Agent Runtime',
        providerTargetId: 'provider-target-kanban-agent',
        agentId: 'agent-kanban',
      }).run()

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-kanban-agent',
        },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban-agent',
          title: 'Agent-created issue',
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue
      expect(issue).toEqual(expect.objectContaining({ id: 'KAG-001', number: 1 }))
      expect(issue).toEqual(expect.objectContaining({
        createdByKind: 'agent',
        createdById: 'agent-kanban',
        sourceChatSessionId: 'chat-session-kanban-agent',
      }))

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-kanban-agent',
        },
        body: JSON.stringify({ content: 'Agent status update' }),
      }))
      expect(addComment.status).toBe(200)
      expect(await addComment.json()).toEqual(expect.objectContaining({
        authorKind: 'agent',
        authorId: 'agent-kanban',
        sourceChatSessionId: 'chat-session-kanban-agent',
        author: expect.objectContaining({
          kind: 'agent',
          id: 'agent-kanban',
          displayName: 'Kanban Agent',
          label: 'Agent',
        }),
        content: 'Agent status update',
      }))

      const activityRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/activity`))
      expect(activityRes.status).toBe(200)
      const activity = await activityRes.json() as Array<{
        kind: string
        actor: { kind: string, id: string | null, displayName: string }
        sourceChatSessionId: string | null
        comment: { content: string } | null
      }>
      expect(activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'created',
          actor: expect.objectContaining({ kind: 'agent', id: 'agent-kanban', displayName: 'Kanban Agent' }),
          sourceChatSessionId: 'chat-session-kanban-agent',
        }),
        expect.objectContaining({
          kind: 'comment',
          actor: expect.objectContaining({ kind: 'agent', id: 'agent-kanban', displayName: 'Kanban Agent' }),
          comment: expect.objectContaining({ content: 'Agent status update' }),
          sourceChatSessionId: 'chat-session-kanban-agent',
        }),
      ]))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('records Jarvis comments as system provenance from the jar-core chat session', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-jarvis-comment',
        name: 'Workspace Jarvis Comment',
        identifier: 'JAR',
        path: workspaceRoot,
      })).run()
      db().insert(providerTargets).values({
        id: 'provider-target-jarvis-runtime',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Jar Core Runtime',
      }).run()

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'chat-session-jarvis-comment',
          workspaceId: 'workspace-jarvis-comment',
          title: 'Jarvis Runtime',
          providerTargetId: 'provider-target-jarvis-runtime',
          runtimeKind: 'jar-core',
        }),
      }))
      expect(sessionRes.status).toBe(200)

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-jarvis-comment',
          title: 'Jarvis-authored comment issue',
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-jarvis-comment',
        },
        body: JSON.stringify({ content: 'Jarvis owns this comment' }),
      }))
      expect(addComment.status).toBe(200)
      expect(await addComment.json()).toEqual(expect.objectContaining({
        authorKind: 'system',
        authorId: 'jarvis',
        sourceChatSessionId: 'chat-session-jarvis-comment',
        author: expect.objectContaining({
          kind: 'system',
          id: null,
          displayName: 'Cradle',
          label: 'System',
        }),
        content: 'Jarvis owns this comment',
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('records provider-target provenance from provider chat session context', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-kanban-profile-only',
        name: 'Workspace Kanban Profile Only',
        identifier: 'KPO',
        path: workspaceRoot,
      })).run()
      db().insert(providerTargets).values({
        id: 'provider-target-kanban-profile-only',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Local Codex',
      }).run()
      db().insert(sessions).values({
        id: 'chat-session-profile-only',
        workspaceId: 'workspace-kanban-profile-only',
        title: 'Provider Runtime',
        providerTargetId: 'provider-target-kanban-profile-only',
        agentId: null,
      }).run()

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-profile-only',
        },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban-profile-only',
          title: 'Provider-target context issue',
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue
      expect(issue).toEqual(expect.objectContaining({
        createdByKind: 'provider-target',
        createdById: 'provider-target-kanban-profile-only',
        sourceChatSessionId: 'chat-session-profile-only',
      }))

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-profile-only',
        },
        body: JSON.stringify({ content: 'Provider target authored update' }),
      }))

      expect(addComment.status).toBe(200)
      expect(await addComment.json()).toEqual(expect.objectContaining({
        authorKind: 'provider-target',
        authorId: 'provider-target-kanban-profile-only',
        sourceChatSessionId: 'chat-session-profile-only',
        author: expect.objectContaining({
          kind: 'provider-target',
          id: 'provider-target-kanban-profile-only',
          displayName: 'Local Codex',
          label: 'Provider',
        }),
        content: 'Provider target authored update',
      }))

      const activityRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/activity`))
      expect(activityRes.status).toBe(200)
      const activity = await activityRes.json() as Array<{
        kind: string
        actor: { kind: string, id: string | null, displayName: string }
        sourceChatSessionId: string | null
        comment: { content: string } | null
      }>
      expect(activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'created',
          actor: expect.objectContaining({ kind: 'provider-target', id: 'provider-target-kanban-profile-only', displayName: 'Local Codex' }),
          sourceChatSessionId: 'chat-session-profile-only',
        }),
        expect.objectContaining({
          kind: 'comment',
          actor: expect.objectContaining({ kind: 'provider-target', id: 'provider-target-kanban-profile-only', displayName: 'Local Codex' }),
          comment: expect.objectContaining({ content: 'Provider target authored update' }),
          sourceChatSessionId: 'chat-session-profile-only',
        }),
      ]))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('uses workspace-derived issue IDs and skips conflicting IDs with the same prefix', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const firstWorkspaceRoot = makeTempDir('cradle-workspace-')
    const secondWorkspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values([
        workspaceFixture({
          id: 'workspace-app-one',
          name: 'App One',
          identifier: 'APP',
          path: firstWorkspaceRoot,
        }),
        workspaceFixture({
          id: 'workspace-app-two',
          name: 'App Two',
          identifier: 'APP',
          path: secondWorkspaceRoot,
        }),
      ]).run()

      const firstIssueRes = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-app-one', title: 'First APP issue' }),
      }))
      expect(firstIssueRes.status).toBe(200)
      const firstIssue = await firstIssueRes.json() as Issue
      expect(firstIssue).toEqual(expect.objectContaining({ id: 'APP-001', number: 1 }))

      const secondIssueRes = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-app-two', title: 'Second APP issue' }),
      }))
      expect(secondIssueRes.status).toBe(200)
      const secondIssue = await secondIssueRes.json() as Issue
      expect(secondIssue).toEqual(expect.objectContaining({ id: 'APP-002', number: 2 }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(firstWorkspaceRoot, { recursive: true, force: true })
      rmSync(secondWorkspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('moves an issue to another workspace and resets workspace-owned references', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const sourceWorkspaceRoot = makeTempDir('cradle-workspace-')
    const targetWorkspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp({ startBackgroundTasks: false })
      db().insert(workspaces).values([
        workspaceFixture({
          id: 'workspace-source',
          name: 'Source Workspace',
          identifier: 'SRC',
          path: sourceWorkspaceRoot,
        }),
        workspaceFixture({
          id: 'workspace-target',
          name: 'Target Workspace',
          identifier: 'TGT',
          path: targetWorkspaceRoot,
        }),
      ]).run()

      const sourceStatusesRes = await app.handle(new Request('http://localhost/issues/statuses?workspaceId=workspace-source'))
      expect(sourceStatusesRes.status).toBe(200)
      const sourceStatuses = await sourceStatusesRes.json() as KanbanStatus[]
      const sourceTodoStatusId = sourceStatuses.find(status => status.name === 'To Do')?.id
      expect(sourceTodoStatusId).toBeTruthy()

      const targetStatusesRes = await app.handle(new Request('http://localhost/issues/statuses?workspaceId=workspace-target'))
      expect(targetStatusesRes.status).toBe(200)
      const targetStatuses = await targetStatusesRes.json() as KanbanStatus[]
      const targetBacklogStatusId = targetStatuses.find(status => status.name === 'Backlog')?.id
      expect(targetBacklogStatusId).toBeTruthy()

      for (const title of ['Target one', 'Target two']) {
        const response = await app.handle(new Request('http://localhost/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId: 'workspace-target', title }),
        }))
        expect(response.status).toBe(200)
      }

      const milestoneRes = await app.handle(new Request('http://localhost/issues/milestones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-source', title: 'Source milestone' }),
      }))
      expect(milestoneRes.status).toBe(200)
      const milestone = await milestoneRes.json() as { id: string }

      const parentRes = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-source', title: 'Source parent' }),
      }))
      expect(parentRes.status).toBe(200)
      const parent = await parentRes.json() as Issue

      const issueRes = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-source',
          title: 'Move me',
          statusId: sourceTodoStatusId,
          milestoneId: milestone.id,
          parentIssueId: parent.id,
        }),
      }))
      expect(issueRes.status).toBe(200)
      const issue = await issueRes.json() as Issue & { milestoneId: string, parentIssueId: string }
      expect(issue).toEqual(expect.objectContaining({
        id: 'SRC-002',
        number: 2,
        workspaceId: 'workspace-source',
        milestoneId: milestone.id,
        parentIssueId: parent.id,
      }))

      const moveRes = await app.handle(new Request(`http://localhost/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-target' }),
      }))
      expect(moveRes.status).toBe(200)
      const moved = await moveRes.json() as Issue & { milestoneId: string | null, parentIssueId: string | null }
      expect(moved).toEqual(expect.objectContaining({
        id: 'SRC-002',
        number: 3,
        workspaceId: 'workspace-target',
        statusId: targetBacklogStatusId,
        milestoneId: null,
        parentIssueId: null,
      }))

      const activityRes = await app.handle(new Request(`http://localhost/issues/${issue.id}/activity`))
      expect(activityRes.status).toBe(200)
      const activity = await activityRes.json() as Array<{ fieldChange: { field: string | null } | null }>
      expect(activity.some(item => item.fieldChange?.field === 'workspace')).toBe(true)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(sourceWorkspaceRoot, { recursive: true, force: true })
      rmSync(targetWorkspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('returns structured errors for invalid input and missing resources', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-kanban',
        name: 'Workspace Kanban',
        path: workspaceRoot,
      })).run()

      const invalidBoard = await app.handle(new Request('http://localhost/kanban/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-kanban' }),
      }))
      expect(invalidBoard.status).toBe(400)
      expect((await invalidBoard.json()).code).toBe('validation_error')

      const missingWorkspaceBoard = await app.handle(new Request('http://localhost/kanban/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'missing', name: 'Nope' }),
      }))
      expect(missingWorkspaceBoard.status).toBe(404)
      expect((await missingWorkspaceBoard.json()).code).toBe('kanban_workspace_not_found')

      const missingIssue = await app.handle(new Request('http://localhost/issues/missing-issue'))
      expect(missingIssue.status).toBe(404)
      expect((await missingIssue.json()).code).toBe('issue_not_found')

      const missingBoardDelete = await app.handle(new Request('http://localhost/kanban/boards/missing-board', { method: 'DELETE' }))
      expect(missingBoardDelete.status).toBe(404)
      expect((await missingBoardDelete.json()).code).toBe('kanban_board_not_found')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})

describe('issue-execution association', () => {
  interface AssociationFixture {
    app: Awaited<ReturnType<typeof createServerApp>>
    issueA1: Issue
    issueA2: Issue
    issueB: Issue
    cleanup: () => void
  }

  async function setupAssociationFixture(): Promise<AssociationFixture> {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    const app = await createServerApp()

    db().insert(workspaces).values([
      workspaceFixture({
        id: 'workspace-assoc-a',
        name: 'Workspace Assoc A',
        identifier: 'WSA',
        path: join(workspaceRoot, 'a'),
      }),
      workspaceFixture({
        id: 'workspace-assoc-b',
        name: 'Workspace Assoc B',
        identifier: 'WSB',
        path: join(workspaceRoot, 'b'),
      }),
    ]).run()

    db().insert(providerTargets).values({
      id: 'provider-target-assoc',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Association Provider',
    }).run()

    async function createIssue(workspaceId: string, title: string): Promise<Issue> {
      const res = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, title }),
      }))
      expect(res.status).toBe(200)
      return await res.json() as Issue
    }

    const issueA1 = await createIssue('workspace-assoc-a', 'Issue A1')
    const issueA2 = await createIssue('workspace-assoc-a', 'Issue A2')
    const issueB = await createIssue('workspace-assoc-b', 'Issue B')

    return {
      app,
      issueA1,
      issueA2,
      issueB,
      cleanup: () => {
        shutdownInfra()
        rmSync(dataDir, { recursive: true, force: true })
        rmSync(workspaceRoot, { recursive: true, force: true })
        if (previousDataDir === undefined) {
          delete process.env.CRADLE_DATA_DIR
        }
        else {
          process.env.CRADLE_DATA_DIR = previousDataDir
        }
      },
    }
  }

  async function createSession(app: AssociationFixture['app'], body: Record<string, unknown>) {
    const res = await app.handle(new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    return res
  }

  async function linkSession(app: AssociationFixture['app'], sessionId: string, issueId: string) {
    return await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(sessionId)}/linked-issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issueId }),
    }))
  }

  async function readLinkedIssue(app: AssociationFixture['app'], sessionId: string): Promise<{ issueId: string | null }> {
    const res = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(sessionId)}/linked-issue`))
    expect(res.status).toBe(200)
    return await res.json() as { issueId: string | null }
  }

  it('links, relinks, and unlinks a session within one workspace with typed transitions', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1, issueA2 } = fixture
    try {
      const createRes = await createSession(app, {
        workspaceId: 'workspace-assoc-a',
        title: 'Linked chat',
        providerTargetId: 'provider-target-assoc',
      })
      expect(createRes.status).toBe(200)
      const session = await createRes.json() as { id: string }

      const linkRes = await linkSession(app, session.id, issueA1.id)
      expect(linkRes.status).toBe(200)
      expect(await linkRes.json()).toEqual({
        participantKind: 'session',
        participantId: session.id,
        previousIssueId: null,
        nextIssueId: issueA1.id,
      })
      expect(await readLinkedIssue(app, session.id)).toEqual({ issueId: issueA1.id })

      const relinkRes = await linkSession(app, session.id, issueA2.id)
      expect(relinkRes.status).toBe(200)
      expect(await relinkRes.json()).toEqual({
        participantKind: 'session',
        participantId: session.id,
        previousIssueId: issueA1.id,
        nextIssueId: issueA2.id,
      })

      const unlinkRes = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(session.id)}/linked-issue`, {
        method: 'DELETE',
      }))
      expect(unlinkRes.status).toBe(200)
      expect(await unlinkRes.json()).toEqual({
        participantKind: 'session',
        participantId: session.id,
        previousIssueId: issueA2.id,
        nextIssueId: null,
      })
      expect(await readLinkedIssue(app, session.id)).toEqual({ issueId: null })
    }
    finally {
      fixture.cleanup()
    }
  })

  it('rejects cross-workspace session links and preserves the previous association', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1, issueB } = fixture
    try {
      const createRes = await createSession(app, {
        workspaceId: 'workspace-assoc-a',
        title: 'Linked chat',
        providerTargetId: 'provider-target-assoc',
      })
      const session = await createRes.json() as { id: string }

      const crossLinkRes = await linkSession(app, session.id, issueB.id)
      expect(crossLinkRes.status).toBe(409)
      expect((await crossLinkRes.json()).code).toBe('issue_workspace_mismatch')
      expect(await readLinkedIssue(app, session.id)).toEqual({ issueId: null })

      const linkRes = await linkSession(app, session.id, issueA1.id)
      expect(linkRes.status).toBe(200)

      const crossRelinkRes = await linkSession(app, session.id, issueB.id)
      expect(crossRelinkRes.status).toBe(409)
      expect((await crossRelinkRes.json()).code).toBe('issue_workspace_mismatch')
      expect(await readLinkedIssue(app, session.id)).toEqual({ issueId: issueA1.id })
    }
    finally {
      fixture.cleanup()
    }
  })

  it('rejects association mutations for missing sessions or issues', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1 } = fixture
    try {
      const createRes = await createSession(app, {
        workspaceId: 'workspace-assoc-a',
        title: 'Linked chat',
        providerTargetId: 'provider-target-assoc',
      })
      const session = await createRes.json() as { id: string }

      const missingIssueRes = await linkSession(app, session.id, 'missing-issue')
      expect(missingIssueRes.status).toBe(404)
      expect((await missingIssueRes.json()).code).toBe('issue_not_found')
      expect(await readLinkedIssue(app, session.id)).toEqual({ issueId: null })

      const missingSessionLink = await linkSession(app, 'missing-session', issueA1.id)
      expect(missingSessionLink.status).toBe(404)
      expect((await missingSessionLink.json()).code).toBe('session_not_found')

      const missingSessionUnlink = await app.handle(new Request('http://localhost/sessions/missing-session/linked-issue', {
        method: 'DELETE',
      }))
      expect(missingSessionUnlink.status).toBe(404)
      expect((await missingSessionUnlink.json()).code).toBe('session_not_found')

      const missingSessionRead = await app.handle(new Request('http://localhost/sessions/missing-session/linked-issue'))
      expect(missingSessionRead.status).toBe(404)
    }
    finally {
      fixture.cleanup()
    }
  })

  it('validates linkedIssueId on session create-with-link', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1, issueB } = fixture
    try {
      const linkedRes = await createSession(app, {
        id: 'session-link-ok',
        workspaceId: 'workspace-assoc-a',
        title: 'Linked at create',
        providerTargetId: 'provider-target-assoc',
        linkedIssueId: issueA1.id,
      })
      expect(linkedRes.status).toBe(200)
      expect(await linkedRes.json()).toEqual(expect.objectContaining({ linkedIssueId: issueA1.id }))
      expect(await readLinkedIssue(app, 'session-link-ok')).toEqual({ issueId: issueA1.id })

      const crossWorkspaceRes = await createSession(app, {
        id: 'session-link-cross',
        workspaceId: 'workspace-assoc-a',
        title: 'Cross workspace link',
        providerTargetId: 'provider-target-assoc',
        linkedIssueId: issueB.id,
      })
      expect(crossWorkspaceRes.status).toBe(409)
      expect((await crossWorkspaceRes.json()).code).toBe('issue_workspace_mismatch')
      const missingSession = await app.handle(new Request('http://localhost/sessions/session-link-cross'))
      expect(missingSession.status).toBe(404)

      const missingIssueRes = await createSession(app, {
        id: 'session-link-missing',
        workspaceId: 'workspace-assoc-a',
        title: 'Missing issue link',
        providerTargetId: 'provider-target-assoc',
        linkedIssueId: 'missing-issue',
      })
      expect(missingIssueRes.status).toBe(404)
      expect((await missingIssueRes.json()).code).toBe('issue_not_found')
      const missingCreated = await app.handle(new Request('http://localhost/sessions/session-link-missing'))
      expect(missingCreated.status).toBe(404)
    }
    finally {
      fixture.cleanup()
    }
  })

  it('rejects linkedIssueId for sessions without a workspace', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1 } = fixture
    try {
      const unboundRes = await createSession(app, {
        id: 'session-unbound',
        workspaceId: null,
        title: 'Unbound session',
        providerTargetId: 'provider-target-assoc',
      })
      expect(unboundRes.status).toBe(200)

      const linkRes = await linkSession(app, 'session-unbound', issueA1.id)
      expect(linkRes.status).toBe(409)
      expect((await linkRes.json()).code).toBe('issue_workspace_mismatch')

      const createRes = await createSession(app, {
        id: 'session-unbound-link',
        workspaceId: null,
        title: 'Unbound linked session',
        providerTargetId: 'provider-target-assoc',
        linkedIssueId: issueA1.id,
      })
      expect(createRes.status).toBe(409)
      expect((await createRes.json()).code).toBe('issue_workspace_mismatch')
      const missingCreated = await app.handle(new Request('http://localhost/sessions/session-unbound-link'))
      expect(missingCreated.status).toBe(404)
    }
    finally {
      fixture.cleanup()
    }
  })

  it('enforces the same invariant for session group create and update-with-link', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1, issueA2, issueB } = fixture
    try {
      const createRes = await app.handle(new Request('http://localhost/session-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-assoc-a',
          title: 'Linked group',
          linkedIssueId: issueA1.id,
        }),
      }))
      expect(createRes.status).toBe(200)
      const group = await createRes.json() as { id: string, linkedIssueId: string | null }
      expect(group.linkedIssueId).toBe(issueA1.id)

      const crossCreateRes = await app.handle(new Request('http://localhost/session-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-assoc-a',
          title: 'Cross-workspace group',
          linkedIssueId: issueB.id,
        }),
      }))
      expect(crossCreateRes.status).toBe(409)
      expect((await crossCreateRes.json()).code).toBe('issue_workspace_mismatch')
      const listRes = await app.handle(new Request('http://localhost/session-groups?workspaceId=workspace-assoc-a'))
      expect(await listRes.json()).toHaveLength(1)

      const relinkRes = await app.handle(new Request(`http://localhost/session-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ linkedIssueId: issueA2.id }),
      }))
      expect(relinkRes.status).toBe(200)
      const relinkBody = await relinkRes.json()
      expect(relinkBody.association).toEqual({
        participantKind: 'session-group',
        participantId: group.id,
        previousIssueId: issueA1.id,
        nextIssueId: issueA2.id,
      })
      expect(relinkBody.group.linkedIssueId).toBe(issueA2.id)

      const crossUpdateRes = await app.handle(new Request(`http://localhost/session-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ linkedIssueId: issueB.id }),
      }))
      expect(crossUpdateRes.status).toBe(409)
      expect((await crossUpdateRes.json()).code).toBe('issue_workspace_mismatch')
      const unchangedRes = await app.handle(new Request(`http://localhost/session-groups/${group.id}`))
      expect((await unchangedRes.json()).linkedIssueId).toBe(issueA2.id)

      const unlinkRes = await app.handle(new Request(`http://localhost/session-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ linkedIssueId: null }),
      }))
      expect(unlinkRes.status).toBe(200)
      const unlinkBody = await unlinkRes.json()
      expect(unlinkBody.association).toEqual({
        participantKind: 'session-group',
        participantId: group.id,
        previousIssueId: issueA2.id,
        nextIssueId: null,
      })
      expect(unlinkBody.group.linkedIssueId).toBeNull()

      const renameRes = await app.handle(new Request(`http://localhost/session-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed group' }),
      }))
      expect(renameRes.status).toBe(200)
      expect((await renameRes.json()).association).toBeNull()

      const missingIssueRes = await app.handle(new Request(`http://localhost/session-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ linkedIssueId: 'missing-issue' }),
      }))
      expect(missingIssueRes.status).toBe(404)
      expect((await missingIssueRes.json()).code).toBe('issue_not_found')
    }
    finally {
      fixture.cleanup()
    }
  })

  it('lists linked session groups through the issue association reads', async () => {
    const fixture = await setupAssociationFixture()
    const { app, issueA1, issueB } = fixture
    try {
      const createRes = await app.handle(new Request('http://localhost/session-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-assoc-a',
          title: 'Linked group',
          linkedIssueId: issueA1.id,
        }),
      }))
      const group = await createRes.json() as { id: string }

      const linkedGroupsRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueA1.id)}/session-groups`))
      expect(linkedGroupsRes.status).toBe(200)
      expect(await linkedGroupsRes.json()).toEqual([
        expect.objectContaining({ id: group.id, linkedIssueId: issueA1.id }),
      ])

      const otherIssueGroupsRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueB.id)}/session-groups`))
      expect(otherIssueGroupsRes.status).toBe(200)
      expect(await otherIssueGroupsRes.json()).toEqual([])
    }
    finally {
      fixture.cleanup()
    }
  })
})
