import { backendRuns, backendSessionBindings, issues, messages, nodeSessionLinks, providerTargets, sessions, workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { insertMessageFixtures } from '../../../tests/helpers/message-fixture'
import { localWorkspaceLocatorJson } from '../../../tests/helpers/workspace-fixture'
import { db } from '../../infra'
import { toOpenCodeRuntimeNativeProviderTargetId } from '../chat-runtime-providers/opencode/native-provider-target-id'
import * as IssueAssociation from '../issue/execution-association'
import * as Issue from '../issue/service'
import * as SessionIssueAssociation from './issue-association'
import {
  aggregateSessionStatus,
  create,
  get,
  list,
  markRead,
  markUnread,
} from './service'

afterEach(() => {
  db().delete(backendRuns).run()
  db().delete(backendSessionBindings).run()
  db().delete(messages).run()
  db().delete(sessions).run()
  db().delete(workspaces).run()
})

describe('session service provider target projection', () => {
  it('keeps OpenCode native provider targets out of the session providerTargetId field', () => {
    db().insert(sessions).values({
      id: 'opencode-native-session',
      title: 'OpenCode Native Session',
      runtimeKind: 'opencode',
      providerTargetId: null,
      configJson: JSON.stringify({
        requestedModelId: 'openai/gpt-5',
      }),
    }).run()
    db().insert(backendSessionBindings).values({
      id: 'binding-1',
      chatSessionId: 'opencode-native-session',
      providerTargetId: null,
      runtimeKind: 'opencode',
      backendSessionId: 'ses_open_code',
      requestedModelId: 'openai/gpt-5',
    }).run()

    const session = get('opencode-native-session')

    expect(session?.providerTargetId).toBeNull()
    expect(session?.providerTargetId).not.toBe(toOpenCodeRuntimeNativeProviderTargetId('openai'))
    expect(session?.modelId).toBe('openai/gpt-5')
  })
})

describe('session list activity and status projection', () => {
  it('orders by latest conversation activity within the listed workspace and ignores metadata updates', () => {
    db().insert(workspaces).values([
      {
        id: 'ws-listed',
        name: 'Listed',
        locatorJson: JSON.stringify({ nodeId: 'local', path: '/tmp/listed' }),
      },
      {
        id: 'ws-other',
        name: 'Other',
        locatorJson: JSON.stringify({ nodeId: 'local', path: '/tmp/other' }),
      },
    ]).run()

    db().insert(sessions).values([
      {
        id: 'sess-older-activity',
        workspaceId: 'ws-listed',
        title: 'Older activity',
        createdAt: 100,
        updatedAt: 300,
      },
      {
        id: 'sess-newer-activity',
        workspaceId: 'ws-listed',
        title: 'Newer activity',
        createdAt: 50,
        updatedAt: 400,
      },
      {
        id: 'sess-other-workspace',
        workspaceId: 'ws-other',
        title: 'Other workspace',
        createdAt: 200,
        updatedAt: 900,
      },
    ]).run()

    insertMessageFixtures(db(), [
      {
        id: 'msg-user-older',
        sessionId: 'sess-older-activity',
        role: 'user',
        content: 'older',
        messageJson: '[]',
        createdAt: 500,
      },
      {
        id: 'msg-user-newer',
        sessionId: 'sess-newer-activity',
        role: 'user',
        content: 'newer',
        messageJson: '[]',
        createdAt: 100,
      },
      {
        id: 'msg-user-other',
        sessionId: 'sess-other-workspace',
        role: 'user',
        content: 'other',
        messageJson: '[]',
        createdAt: 900,
      },
      {
        id: 'msg-assistant-newer',
        sessionId: 'sess-newer-activity',
        role: 'assistant',
        status: 'complete',
        content: 'reply',
        messageJson: '[]',
        createdAt: 110,
        updatedAt: 700,
      },
    ])

    const rows = list({ workspaceId: 'ws-listed' }).items
    expect(rows.map(row => row.id)).toEqual(['sess-newer-activity', 'sess-older-activity'])
    expect(rows[0]?.latestUserMessageAt).toBe(100)
    expect(rows[0]?.latestAssistantMessageAt).toBe(110)
    expect(rows[0]?.activityAt).toBe(700)
    expect(rows[1]?.latestUserMessageAt).toBe(500)
    expect(rows.every(row => row.id !== 'sess-other-workspace')).toBe(true)
  })

  it('orders node projections by their reconciled remote user activity', () => {
    db().insert(workspaces).values({
      id: 'ws-node',
      name: 'Node',
      locatorJson: JSON.stringify({ nodeId: 'node-1', path: '/tmp/node' }),
    }).run()
    db().insert(sessions).values([
      { id: 'node-older', workspaceId: 'ws-node', title: 'Older', createdAt: 90, updatedAt: 999 },
      { id: 'node-newer', workspaceId: 'ws-node', title: 'Newer', createdAt: 100, updatedAt: 100 },
    ]).run()
    db().insert(nodeSessionLinks).values([
      {
        localSessionId: 'node-older',
        nodeId: 'node-1',
        remoteSessionId: 'remote-older',
        remoteWorkspaceId: 'remote-ws',
        latestUserMessageAt: 200,
      },
      {
        localSessionId: 'node-newer',
        nodeId: 'node-1',
        remoteSessionId: 'remote-newer',
        remoteWorkspaceId: 'remote-ws',
        latestUserMessageAt: 800,
        latestAssistantMessageAt: 810,
      },
    ]).run()

    const rows = list({ workspaceId: 'ws-node' }).items

    expect(rows.map(row => row.id)).toEqual(['node-newer', 'node-older'])
    expect(rows[0]).toMatchObject({
      latestUserMessageAt: 800,
      latestAssistantMessageAt: 810,
    })
  })

  it('uses assistant completion time as the unread boundary', () => {
    db().insert(sessions).values({
      id: 'sess-unread',
      title: 'Unread session',
      createdAt: 100,
      updatedAt: 100,
      lastReadAt: 100,
    }).run()
    insertMessageFixtures(db(), {
      id: 'msg-assistant-completed',
      sessionId: 'sess-unread',
      role: 'assistant',
      status: 'complete',
      content: 'reply',
      messageJson: '[]',
      createdAt: 120,
      updatedAt: 200,
    })

    expect(get('sess-unread')).toMatchObject({
      activityAt: 200,
      latestAssistantMessageAt: 120,
      unread: true,
    })
    expect(markRead('sess-unread')).toMatchObject({
      lastReadAt: 120,
      updatedAt: 100,
      unread: false,
    })
    expect(markUnread('sess-unread')).toMatchObject({
      lastReadAt: 119,
      unread: true,
    })
  })

  it('persists read state for node-projected sessions without advancing the projection clock', () => {
    db().insert(sessions).values({
      id: 'sess-node-unread',
      title: 'Remote unread session',
      createdAt: 100,
      updatedAt: 150,
      lastReadAt: 100,
    }).run()
    db().insert(nodeSessionLinks).values({
      localSessionId: 'sess-node-unread',
      nodeId: 'node-1',
      remoteSessionId: 'remote-session-1',
      remoteWorkspaceId: 'remote-workspace-1',
      latestUserMessageAt: 180,
      latestAssistantMessageAt: 200,
    }).run()

    expect(get('sess-node-unread')).toMatchObject({
      activityAt: 200,
      latestAssistantMessageAt: 200,
      unread: true,
    })
    expect(markRead('sess-node-unread')).toMatchObject({
      lastReadAt: 200,
      updatedAt: 150,
      unread: false,
    })
    expect(list().items.find(session => session.id === 'sess-node-unread'))
      .toMatchObject({ lastReadAt: 200, unread: false })
  })

  it('projects status from the latest backend run per session only', () => {
    db().insert(sessions).values({
      id: 'sess-status',
      title: 'Status session',
      createdAt: 1,
      updatedAt: 1,
    }).run()

    db().insert(backendRuns).values([
      {
        id: 'run-old-failed',
        bindingId: null,
        chatSessionId: 'sess-status',
        messageId: null,
        origin: 'user',
        status: 'failed',
        startedAt: 10,
        finishedAt: 11,
      },
      {
        id: 'run-newer-complete',
        bindingId: null,
        chatSessionId: 'sess-status',
        messageId: null,
        origin: 'user',
        status: 'complete',
        startedAt: 20,
        finishedAt: 21,
      },
      {
        id: 'run-same-time-streaming',
        bindingId: null,
        chatSessionId: 'sess-status',
        messageId: null,
        origin: 'user',
        status: 'streaming',
        startedAt: 20,
        finishedAt: null,
      },
    ]).run()

    const row = list().items.find(session => session.id === 'sess-status')
    expect(row?.status).toBe('streaming')
    expect(aggregateSessionStatus(['sess-status'])).toBe('streaming')
    expect(get('sess-status')?.status).toBe('streaming')
  })

  it('returns stable bounded cursor pages', () => {
    db().insert(sessions).values(Array.from({ length: 205 }, (_, index) => ({
      id: `paged-session-${String(index).padStart(3, '0')}`,
      title: `Paged session ${index}`,
      createdAt: 1_000 - index,
      updatedAt: 1_000 - index,
    }))).run()

    const first = list({ limit: 100 })
    const second = list({ limit: 100, cursor: first.nextCursor ?? undefined })
    const third = list({ limit: 100, cursor: second.nextCursor ?? undefined })

    expect(first.items).toHaveLength(100)
    expect(second.items).toHaveLength(100)
    expect(third.items).toHaveLength(5)
    expect(third.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items, ...third.items].map(row => row.id)).size).toBe(205)
  })
})

describe('session issue association', () => {
  const WORKSPACE_A = 'ws-issue-assoc-a'
  const WORKSPACE_B = 'ws-issue-assoc-b'

  beforeEach(() => {
    // Register the Issue-owned invariant validator — the same gate the
    // composition root wires in app.ts.
    SessionIssueAssociation.registerLinkedIssueValidator(IssueAssociation.assertSessionLinkedIssue)
    db().insert(workspaces).values([
      {
        id: WORKSPACE_A,
        name: 'Assoc A',
        locatorJson: localWorkspaceLocatorJson('/tmp/ws-assoc-a'),
        identifier: 'WAA',
      },
      {
        id: WORKSPACE_B,
        name: 'Assoc B',
        locatorJson: localWorkspaceLocatorJson('/tmp/ws-assoc-b'),
        identifier: 'WBB',
      },
    ]).run()
    db().insert(providerTargets).values({
      id: 'provider-target-assoc',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Association Provider',
    }).run()
  })

  afterEach(() => {
    // Inner afterEach runs before the file-level cleanup; delete the session
    // rows first so the providerTargets/issues deletes cannot hit FK guards.
    db().delete(sessions).run()
    db().delete(issues).run()
    db().delete(providerTargets).run()
  })

  it('persists a linked issue on create when the workspace matches', async () => {
    const issue = Issue.createIssue({ workspaceId: WORKSPACE_A, title: 'Linked issue' })

    const session = await create({
      id: 'session-linked-create',
      workspaceId: WORKSPACE_A,
      title: 'Linked session',
      providerTargetId: 'provider-target-assoc',
      linkedIssueId: issue.id,
    })

    expect(session.linkedIssueId).toBe(issue.id)
    expect(SessionIssueAssociation.readIssueAssociationState(session.id)).toEqual({
      sessionId: session.id,
      workspaceId: WORKSPACE_A,
      linkedIssueId: issue.id,
    })
  })

  it('rejects create-with-link across workspaces without leaving a session row', async () => {
    const otherIssue = Issue.createIssue({ workspaceId: WORKSPACE_B, title: 'Other workspace issue' })

    await expect(create({
      id: 'session-cross-link',
      workspaceId: WORKSPACE_A,
      title: 'Cross workspace link',
      providerTargetId: 'provider-target-assoc',
      linkedIssueId: otherIssue.id,
    })).rejects.toThrowError(expect.objectContaining({
      code: 'issue_workspace_mismatch',
      status: 409,
    }))
    expect(get('session-cross-link')).toBeNull()
  })

  it('rejects create-with-link for sessions without a workspace', async () => {
    const issue = Issue.createIssue({ workspaceId: WORKSPACE_A, title: 'Issue' })

    await expect(create({
      id: 'session-unbound-link',
      workspaceId: null,
      title: 'Unbound session',
      providerTargetId: 'provider-target-assoc',
      linkedIssueId: issue.id,
    })).rejects.toThrowError(expect.objectContaining({
      code: 'issue_workspace_mismatch',
      status: 409,
    }))
    expect(get('session-unbound-link')).toBeNull()
  })

  it('rejects create-with-link when the issue does not exist', async () => {
    await expect(create({
      id: 'session-missing-issue',
      workspaceId: WORKSPACE_A,
      title: 'Missing issue link',
      providerTargetId: 'provider-target-assoc',
      linkedIssueId: 'missing-issue',
    })).rejects.toThrowError(expect.objectContaining({
      code: 'issue_not_found',
      status: 404,
    }))
    expect(get('session-missing-issue')).toBeNull()
  })

  it('fails closed when no Issue validator is registered', async () => {
    SessionIssueAssociation.registerLinkedIssueValidator(null)
    const issue = Issue.createIssue({ workspaceId: WORKSPACE_A, title: 'Issue' })

    await expect(create({
      id: 'session-no-gate',
      workspaceId: WORKSPACE_A,
      title: 'No gate session',
      providerTargetId: 'provider-target-assoc',
      linkedIssueId: issue.id,
    })).rejects.toThrowError(expect.objectContaining({
      code: 'issue_link_validation_unavailable',
      status: 500,
    }))
    expect(get('session-no-gate')).toBeNull()
  })

  it('exposes narrow read/write commands for the association column', async () => {
    const issue = Issue.createIssue({ workspaceId: WORKSPACE_A, title: 'Issue' })
    const session = await create({
      id: 'session-commands',
      workspaceId: WORKSPACE_A,
      title: 'Command target',
      providerTargetId: 'provider-target-assoc',
    })

    expect(SessionIssueAssociation.readIssueAssociationState(session.id)).toEqual({
      sessionId: session.id,
      workspaceId: WORKSPACE_A,
      linkedIssueId: null,
    })

    const next = SessionIssueAssociation.writeLinkedIssue({ sessionId: session.id, issueId: issue.id })
    expect(next.linkedIssueId).toBe(issue.id)
    expect(SessionIssueAssociation.readIssueAssociationState(session.id).linkedIssueId).toBe(issue.id)

    SessionIssueAssociation.writeLinkedIssue({ sessionId: session.id, issueId: null })
    expect(SessionIssueAssociation.readIssueAssociationState(session.id).linkedIssueId).toBeNull()

    expect(() => SessionIssueAssociation.readIssueAssociationState('missing-session'))
      .toThrowError(expect.objectContaining({ code: 'session_not_found', status: 404 }))
  })
})
