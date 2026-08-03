// Module tests for issue-agent delegation invariants: delegation guard rails,
// delegation-state projection, tracked run settlement transitions, and
// continuation input validation. No provider run is started: every covered
// path either rejects before `runSession` fires or drives the tracked-run map
// through the exported test hooks.

import { randomUUID } from 'node:crypto'

import {
  agentActivities,
  agents,
  agentSessions,
  issueComments,
  issues,
  issueStatuses,
  providerTargets,
  workspaces,
} from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../infra'
import * as AgentInteraction from '../agent-interaction-runtime/service'
import * as Issue from '../issue/service'
import {
  delegateIssue,
  enqueueContinuation,
  getDelegation,
  issueAgentRunTrackingTestHooks,
  listSessions,
  rerunSession,
} from './service'

function seedWorkspace(): string {
  const workspaceId = randomUUID()
  db().insert(workspaces).values({
    id: workspaceId,
    name: 'ws',
    // locator_json is uniquely indexed — each seed needs a distinct path.
    locatorJson: JSON.stringify({ hostId: 'local', path: `/tmp/issue-agent-${workspaceId}` }),
  }).run()
  return workspaceId
}

function seedProviderTarget(input: { enabled?: boolean } = {}): string {
  const providerTargetId = randomUUID()
  db().insert(providerTargets).values({
    id: providerTargetId,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: 'Issue Agent Provider',
    enabled: input.enabled ?? true,
  }).run()
  return providerTargetId
}

function seedAgent(input: {
  providerTargetId?: string | null
  enabled?: boolean
} = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const agentId = randomUUID()
  db().insert(agents).values({
    id: agentId,
    name: 'Issue Worker',
    avatarSeed: 'issue-worker',
    providerTargetId: input.providerTargetId ?? null,
    runtimeKind: 'standard',
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }).run()
  return agentId
}

describe('issue-agent delegation invariants', () => {
  afterEach(() => {
    issueAgentRunTrackingTestHooks.clearActiveRuns()
    db().delete(agentActivities).run()
    db().delete(agentSessions).run()
    db().delete(agents).run()
    db().delete(issueComments).run()
    db().delete(issues).run()
    db().delete(issueStatuses).run()
    db().delete(providerTargets).run()
    db().delete(workspaces).run()
  })

  it('rejects delegation to unusable agent identities without writing delegation state', async () => {
    const workspaceId = seedWorkspace()
    const issue = Issue.createIssue({ workspaceId, title: 'Guarded issue' })
    const providerTargetId = seedProviderTarget()

    const disabledAgent = seedAgent({ providerTargetId, enabled: false })
    await expect(delegateIssue({ issueId: issue.id, agentId: disabledAgent })).rejects.toEqual(
      expect.objectContaining({ code: 'issue_agent_agent_not_available' }),
    )

    const identityOnlyAgent = seedAgent({ providerTargetId: null })
    await expect(delegateIssue({ issueId: issue.id, agentId: identityOnlyAgent })).rejects.toEqual(
      expect.objectContaining({ code: 'issue_agent_agent_not_supported' }),
    )

    const validAgent = seedAgent({ providerTargetId })
    await expect(
      delegateIssue({
        issueId: issue.id,
        agentId: validAgent,
        providerTargetId: 'some-other-provider-target',
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'issue_agent_identity_mismatch' }))

    const disabledTarget = seedProviderTarget({ enabled: false })
    const agentOnDisabledTarget = seedAgent({ providerTargetId: disabledTarget })
    await expect(
      delegateIssue({ issueId: issue.id, agentId: agentOnDisabledTarget }),
    ).rejects.toEqual(
      expect.objectContaining({ code: 'issue_agent_provider_target_not_available' }),
    )

    // None of the rejected paths may leave delegation state behind.
    expect(Issue.getIssue(issue.id)).toEqual(expect.objectContaining({
      delegateAgentId: null,
      delegateProviderTargetId: null,
    }))
    expect(AgentInteraction.listSessionsForIssue(issue.id)).toHaveLength(0)
    expect(Issue.listComments(issue.id)).toEqual([])
  })

  it('rejects a second delegation while the current delegation has a tracked run', async () => {
    const workspaceId = seedWorkspace()
    const issue = Issue.createIssue({ workspaceId, title: 'Busy issue' })
    const providerTargetId = seedProviderTarget()
    const agentId = seedAgent({ providerTargetId })

    const session = AgentInteraction.createSession({
      issueId: issue.id,
      providerTargetId,
      agentId,
    })
    issueAgentRunTrackingTestHooks.setActiveRun(session.id, {
      runId: 'run-in-flight',
      chatSessionId: null,
      aborted: false,
    })

    await expect(delegateIssue({ issueId: issue.id, agentId })).rejects.toEqual(
      expect.objectContaining({ code: 'issue_agent_delegation_in_progress' }),
    )
    await expect(rerunSession({ agentSessionId: session.id })).rejects.toEqual(
      expect.objectContaining({ code: 'issue_agent_session_in_progress' }),
    )
    expect(AgentInteraction.listSessionsForIssue(issue.id)).toHaveLength(1)
  })

  it('projects delegation state from the latest agent session and its removal marker', () => {
    const workspaceId = seedWorkspace()
    const issue = Issue.createIssue({ workspaceId, title: 'Projected issue' })
    expect(getDelegation(issue.id)).toEqual(expect.objectContaining({
      delegated: false,
      agentSessionId: null,
    }))

    const providerTargetId = seedProviderTarget()
    const agentId = seedAgent({ providerTargetId })
    const session = AgentInteraction.createSession({
      issueId: issue.id,
      providerTargetId,
      agentId,
    })

    expect(getDelegation(issue.id)).toEqual(expect.objectContaining({
      delegated: true,
      agentSessionId: session.id,
      providerTargetId,
      agentId,
    }))
    expect(listSessions(issue.id)).toEqual([
      expect.objectContaining({ id: session.id, isCurrentDelegation: true }),
    ])

    AgentInteraction.createActivity({
      agentSessionId: session.id,
      type: 'response',
      body: 'Delegation removed',
      signal: 'delegation.removed',
    })

    expect(getDelegation(issue.id)).toEqual(expect.objectContaining({
      delegated: false,
      agentSessionId: null,
    }))
    expect(listSessions(issue.id)).toEqual([
      expect.objectContaining({ id: session.id, isCurrentDelegation: false }),
    ])
  })

  it('settles a failed run into a failed session with the run error recorded', () => {
    const workspaceId = seedWorkspace()
    const issue = Issue.createIssue({ workspaceId, title: 'Failing issue' })
    const providerTargetId = seedProviderTarget()
    const agentId = seedAgent({ providerTargetId })
    const session = AgentInteraction.createSession({
      issueId: issue.id,
      providerTargetId,
      agentId,
    })
    AgentInteraction.updateSessionStatus(session.id, 'active')
    issueAgentRunTrackingTestHooks.setActiveRun(session.id, {
      runId: 'run-1',
      chatSessionId: null,
      aborted: false,
    })

    expect(
      issueAgentRunTrackingTestHooks.settleRunCompletion(session.id, 'run-1', {
        status: 'failed',
        errorText: 'provider exploded',
      }),
    ).toBe(true)

    expect(AgentInteraction.getSession(session.id)?.status).toBe('failed')
    expect(AgentInteraction.listActivities(session.id)).toEqual([
      expect.objectContaining({ type: 'error', signal: 'run.failed' }),
    ])
    expect(JSON.parse(AgentInteraction.listActivities(session.id)[0].content).body).toBe(
      'provider exploded',
    )

    // Settlement consumes the tracked run: a duplicate completion is a no-op.
    expect(
      issueAgentRunTrackingTestHooks.settleRunCompletion(session.id, 'run-1', {
        status: 'complete',
        errorText: null,
      }),
    ).toBe(false)
    expect(AgentInteraction.getSession(session.id)?.status).toBe('failed')
    expect(AgentInteraction.listActivities(session.id)).toHaveLength(1)
  })

  it('records a stop activity only for stops the user did not request', () => {
    const workspaceId = seedWorkspace()
    const issue = Issue.createIssue({ workspaceId, title: 'Stopping issue' })
    const providerTargetId = seedProviderTarget()
    const agentId = seedAgent({ providerTargetId })

    const abortedSession = AgentInteraction.createSession({
      issueId: issue.id,
      providerTargetId,
      agentId,
    })
    issueAgentRunTrackingTestHooks.setActiveRun(abortedSession.id, {
      runId: 'run-aborted',
      chatSessionId: null,
      aborted: true,
    })
    issueAgentRunTrackingTestHooks.settleRunCompletion(abortedSession.id, 'run-aborted', {
      status: 'aborted',
      errorText: null,
    })
    expect(AgentInteraction.getSession(abortedSession.id)?.status).toBe('stopped')
    expect(AgentInteraction.listActivities(abortedSession.id)).toHaveLength(0)

    const externallyStopped = AgentInteraction.createSession({
      issueId: issue.id,
      providerTargetId,
      agentId,
    })
    issueAgentRunTrackingTestHooks.setActiveRun(externallyStopped.id, {
      runId: 'run-stopped',
      chatSessionId: null,
      aborted: false,
    })
    issueAgentRunTrackingTestHooks.settleRunCompletion(externallyStopped.id, 'run-stopped', {
      status: 'aborted',
      errorText: null,
    })
    expect(AgentInteraction.getSession(externallyStopped.id)?.status).toBe('stopped')
    expect(AgentInteraction.listActivities(externallyStopped.id)).toEqual([
      expect.objectContaining({ type: 'response', signal: 'run.aborted' }),
    ])
  })

  it('validates continuation input before touching Chat Runtime', async () => {
    const workspaceId = seedWorkspace()
    const issue = Issue.createIssue({ workspaceId, title: 'Continuation issue' })
    const providerTargetId = seedProviderTarget()
    const agentId = seedAgent({ providerTargetId })
    const session = AgentInteraction.createSession({
      issueId: issue.id,
      providerTargetId,
      agentId,
    })

    await expect(
      enqueueContinuation({ agentSessionId: session.id, mode: 'queue', text: '   ' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'issue_agent_prompt_empty' }))

    await expect(
      enqueueContinuation({ agentSessionId: session.id, mode: 'queue', text: 'Continue' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'issue_agent_chat_session_not_ready' }))

    await expect(
      enqueueContinuation({ agentSessionId: 'missing-session', mode: 'queue', text: 'Continue' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'agent_interaction_session_not_found' }))
  })
})
