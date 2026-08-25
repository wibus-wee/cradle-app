import { backendRuns, backendSessionBindings, messages, sessions, workspaces } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { insertMessageFixtures } from '../../../tests/helpers/message-fixture'
import { db } from '../../infra'
import { toOpenCodeRuntimeNativeProviderTargetId } from '../chat-runtime-providers/opencode/native-provider-target-id'
import { aggregateSessionStatus, get, list } from './service'

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
  it('orders by latest user message within the listed workspace and ignores metadata updates', () => {
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
      },
    ])

    const rows = list({ workspaceId: 'ws-listed' }).items
    expect(rows.map(row => row.id)).toEqual(['sess-older-activity', 'sess-newer-activity'])
    expect(rows[0]?.latestUserMessageAt).toBe(500)
    expect(rows[1]?.latestUserMessageAt).toBe(100)
    expect(rows[1]?.latestAssistantMessageAt).toBe(110)
    expect(rows.every(row => row.id !== 'sess-other-workspace')).toBe(true)
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
