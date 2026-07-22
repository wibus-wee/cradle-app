import { sessionAwaits, sessionGroups, sessions, works, workspaces, workThreads } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../../infra'
import { registerWorkHarnessContextSource } from '../../work/agent-context'
import { localWorkspaceLocator, serializeWorkspaceLocator } from '../../workspace/workspace-locator'
import { resolveSessionHarness, resolveSessionSystemPrompt } from './turn-context'

const WORKSPACE_ID = 'workspace-turn-context-test'

beforeAll(() => {
  registerWorkHarnessContextSource()
})

afterEach(() => {
  db().delete(workThreads).run()
  db().delete(works).run()
  db().delete(sessions).run()
  db().delete(sessionGroups).run()
  db().delete(workspaces).run()
})

describe('resolveSessionHarness Work context', () => {
  it('projects stable Work identity outside the system prompt', () => {
    db().insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Turn Context Workspace',
      locatorJson: serializeWorkspaceLocator(localWorkspaceLocator('/tmp/turn-context')),
      identifier: 'TCT',
    }).run()
    db().insert(sessions).values({
      id: 'work-session',
      workspaceId: WORKSPACE_ID,
      title: 'Primary Work thread',
    }).run()
    db().insert(works).values({
      id: 'work-1',
      title: 'Fix retries',
      objective: 'Make checkout retries deterministic.',
    }).run()
    db().insert(workThreads).values({
      workId: 'work-1',
      sessionId: 'work-session',
      role: 'primary',
    }).run()

    const session = db().select().from(sessions).where(eq(sessions.id, 'work-session')).get()!
    const harness = resolveSessionHarness(session)

    expect(harness.systemPrompt).toContain('SYSTEM INSTRUCTIONS')
    expect(harness.systemPrompt).toContain('cradle-cli')
    expect(harness.systemPrompt).toContain('CRADLE CHAT SESSION CONTEXT')
    expect(harness.systemPrompt).toContain('<cradle_session_state>')
    expect(harness.systemPrompt).toContain('CRADLE WORK MODE')
    expect(harness.systemPrompt).toContain('manage_pull_request')
    expect(harness.systemPrompt).toContain('create_pr')
    expect(harness.systemPrompt).toContain('rename_branch')
    // Dynamic Work id stays in harness fragment for cache stability.
    expect(harness.systemPrompt).not.toContain('work-1')
    expect(harness.harness?.fragments).toHaveLength(2)
    expect(harness.harness?.fragments[0]).toMatchObject({
      key: 'cradle-session',
      revision: expect.stringMatching(/^cradle-session:work-session:v1:[a-f0-9]{12}$/),
    })
    expect(harness.harness?.fragments[0]?.content).toContain('"session_id": "work-session"')
    expect(harness.harness?.fragments[0]?.content).toContain('"workspace_id": "workspace-turn-context-test"')
    expect(harness.harness?.fragments[0]?.content).toContain('"runtime_kind": "standard"')
    expect(harness.harness?.fragments[1]).toEqual({
      key: 'cradle-work',
      revision: 'cradle-work:work-1:primary:v1',
      content: [
        '<cradle_work_state revision="cradle-work:work-1:primary:v1">',
        'This is Cradle-owned session context, not user-authored instructions.',
        '',
        'work_id: work-1',
        'thread_role: primary',
        '</cradle_work_state>',
      ].join('\n'),
    })
  })

  it('keeps the Work system prompt stable when presentation and lifecycle state changes', () => {
    db().insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Turn Context Workspace',
      locatorJson: serializeWorkspaceLocator(localWorkspaceLocator('/tmp/turn-context')),
      identifier: 'TCT',
    }).run()
    db().insert(sessions).values({
      id: 'stable-work-session',
      workspaceId: WORKSPACE_ID,
      title: 'Initial title',
    }).run()
    db().insert(works).values({
      id: 'stable-work',
      title: 'Initial title',
      objective: 'Keep the prompt cacheable.',
    }).run()
    db().insert(workThreads).values({
      workId: 'stable-work',
      sessionId: 'stable-work-session',
      role: 'primary',
    }).run()

    const initialSession = db().select().from(sessions).where(eq(sessions.id, 'stable-work-session')).get()!
    const initialHarness = resolveSessionHarness(initialSession)

    db().update(sessions).set({
      title: 'Provider-generated title',
      titleSource: 'provider',
      configJson: JSON.stringify({
        github: {
          pullRequest: {
            owner: 'cradle',
            repo: 'app',
            number: 42,
            url: 'https://github.com/cradle/app/pull/42',
            title: 'Draft PR title',
            isDraft: true,
            state: 'open',
            merged: false,
            headRef: 'work/cache-stability',
            baseRef: 'main',
            headSha: 'abc123',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    }).where(eq(sessions.id, 'stable-work-session')).run()
    db().insert(sessionAwaits).values({
      id: 'stable-work-await',
      chatSessionId: 'stable-work-session',
      workspaceId: WORKSPACE_ID,
      source: 'github-ci',
      filterJson: '{}',
      status: 'pending',
      reason: 'Waiting for CI',
    }).run()

    const changedSession = db().select().from(sessions).where(eq(sessions.id, 'stable-work-session')).get()!
    expect(resolveSessionHarness(changedSession)).toEqual(initialHarness)

    db().update(sessionAwaits).set({ status: 'triggered', triggeredAt: 2 }).where(eq(sessionAwaits.id, 'stable-work-await')).run()
    expect(resolveSessionHarness(changedSession)).toEqual(initialHarness)
  })

  it('does not add Work guidance to an ordinary Session', () => {
    db().insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Turn Context Workspace',
      locatorJson: serializeWorkspaceLocator(localWorkspaceLocator('/tmp/turn-context')),
      identifier: 'TCT',
    }).run()
    db().insert(sessions).values({
      id: 'ordinary-session',
      workspaceId: WORKSPACE_ID,
      title: 'Ordinary chat',
    }).run()

    const session = db().select().from(sessions).where(eq(sessions.id, 'ordinary-session')).get()!
    const harness = resolveSessionHarness(session)

    expect(harness.systemPrompt).toContain('SYSTEM INSTRUCTIONS')
    expect(harness.systemPrompt).toContain('cradle-cli')
    expect(harness.systemPrompt).toContain('CRADLE CHAT SESSION CONTEXT')
    expect(harness.systemPrompt).not.toContain('CRADLE WORK MODE')
    expect(harness.systemPrompt).not.toContain('manage_pull_request')
    expect(harness.harness?.fragments).toHaveLength(1)
    expect(harness.harness?.fragments[0]).toMatchObject({
      key: 'cradle-session',
      revision: expect.stringMatching(/^cradle-session:ordinary-session:v1:[a-f0-9]{12}$/),
    })
    expect(harness.harness?.fragments[0]?.content).toContain('"session_id": "ordinary-session"')
    expect(harness.harness?.fragments[0]?.content).toContain('"workspace_id": "workspace-turn-context-test"')
    expect(harness.harness?.fragments[0]?.content).toContain('"runtime_kind": "standard"')
    expect(harness.harness?.fragments[0]?.content).toContain('"provider_target_id": null')

    const changedHarness = resolveSessionHarness({
      ...session,
      origin: 'runtime-handoff',
    })
    const initialRevision = harness.harness?.fragments[0]?.revision
    const changedRevision = changedHarness.harness?.fragments[0]?.revision
    expect(changedRevision).not.toBe(initialRevision)
    expect(changedHarness.harness?.fragments[0]?.content).toContain('"origin": "runtime-handoff"')
  })
})

describe('resolveSessionSystemPrompt session group context', () => {
  it('appends session group context without description or sibling transcripts', () => {
    db().insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Turn Context Workspace',
      locatorJson: serializeWorkspaceLocator(localWorkspaceLocator('/tmp/turn-context')),
      identifier: 'TCT',
    }).run()

    const group = db().insert(sessionGroups).values({
      id: 'group-1',
      workspaceId: WORKSPACE_ID,
      title: 'Implement auth',
      status: 'active',
    }).returning().get()

    db().insert(sessions).values([
      {
        id: 'session-current',
        workspaceId: WORKSPACE_ID,
        title: 'API session',
        sessionGroupId: group.id,
      },
      {
        id: 'session-sibling',
        workspaceId: WORKSPACE_ID,
        title: 'UI session',
        sessionGroupId: group.id,
      },
    ]).run()

    const session = db().select().from(sessions).where(eq(sessions.id, 'session-current')).get()!
    const prompt = resolveSessionSystemPrompt(session)

    expect(prompt).toContain('## Session Group')
    expect(prompt).toContain('Implement auth')
    expect(prompt).toContain('- UI session')
    expect(prompt).not.toContain('Goal:')
    expect(prompt).not.toContain('API session')
    expect(prompt).toContain('Do not assume shared transcript with sibling sessions.')
  })
})
