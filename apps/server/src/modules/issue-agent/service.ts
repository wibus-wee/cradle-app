import type { Agent, AgentActivity, AgentSession, BackendRun } from '@cradle/db'
import { agents, providerTargets } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as AgentInteraction from '../agent-interaction-runtime/service'
import * as ChatRuntime from '../chat-runtime/runtime'
import * as Issue from '../issue/service'
import * as Session from '../session/service'
import * as WorkflowRules from '../workflow-rules/service'
import * as Work from '../work/service'
import * as Worktree from '../worktree/service'

// ── types ──

interface ActiveAgentRun {
  runId: string
  chatSessionId: string | null
  aborted: boolean
  workId?: string
}

interface IssueAgentSessionView extends AgentSession {
  isCurrentDelegation: boolean
}

interface IssueAgentDelegationState {
  issueId: string
  delegated: boolean
  providerTargetId: string | null
  agentId: string | null
  agentSessionId: string | null
  chatSessionId: string | null
}

// ── in-memory state ──

const activeRuns = new Map<string, ActiveAgentRun>()
const continuationWatchers = new Map<string, Promise<void>>()
const PENDING_RUN_ID = '__pending__'

// ── require helpers ──

function requireIssue(issueId: string) {
  try {
    return Issue.getIssue(issueId)
  }
 catch {
    throw new AppError({
      code: 'issue_agent_issue_not_found',
      status: 404,
      message: 'Issue not found',
      details: { issueId },
    })
  }
}

function requireProviderTarget(providerTargetId: string) {
  const target = db()
    .select({
      id: providerTargets.id,
      name: providerTargets.displayName,
      enabled: providerTargets.enabled,
    })
    .from(providerTargets)
    .where(eq(providerTargets.id, providerTargetId))
    .get()
  if (!target) {
    throw new AppError({
      code: 'issue_agent_provider_target_not_found',
      status: 404,
      message: 'Provider target not found',
      details: { providerTargetId },
    })
  }
  return target
}

function requireDelegationAgent(agentId: string): Agent & { providerTargetId: string } {
  const agent = db().select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) {
    throw new AppError({
      code: 'issue_agent_agent_not_found',
      status: 404,
      message: 'Agent not found',
      details: { agentId },
    })
  }
  if (!agent.enabled) {
    throw new AppError({
      code: 'issue_agent_agent_not_available',
      status: 409,
      message: 'Agent is disabled',
      details: { agentId },
    })
  }
  if (!agent.providerTargetId) {
    throw new AppError({
      code: 'issue_agent_agent_not_supported',
      status: 409,
      message: 'Issue delegation requires a provider-backed agent',
      details: { agentId, runtimeKind: agent.runtimeKind },
    })
  }

  return {
    ...agent,
    providerTargetId: agent.providerTargetId,
  }
}

function requireAgentSession(agentSessionId: string) {
  return AgentInteraction.requireSession(agentSessionId)
}

// ── prompt builder ──

function buildIssuePrompt(
  issue: {
    id: string
    title: string
    description: string | null
    priority: string
    labels: string[]
    contextRefs: string
  },
  rules: { global: string | null, agentSpecific: string | null },
): string {
  const parts = [`# Cradle Issue: ${issue.title}`, '', `Cradle Issue ID: ${issue.id}`, '']

  if (issue.description) {
    parts.push(issue.description, '')
  }

  parts.push(`Priority: ${issue.priority}`)

  if (issue.labels.length > 0) {
    parts.push(`Labels: ${issue.labels.join(', ')}`)
  }

  const refs = Issue.IssuePromptContextRefsJsonSchema.parse(issue.contextRefs)
  if (refs.length > 0) {
    parts.push('', '## Context')
    refs.forEach((ref) => {
      parts.push(`- [${ref.type}] ${ref.label ?? ref.value}`)
    })
  }

  if (rules.global || rules.agentSpecific) {
    parts.push('', '## Workflow Rules')
    if (rules.global) {
      parts.push(rules.global)
    }
    if (rules.agentSpecific) {
      parts.push(rules.agentSpecific)
    }
  }

  parts.push(
    '',
    'Please work on this issue. When done, summarize what you changed. Send the summary as a comment on the Cradle issue. If you need to ask for more information, send a comment on Cradle.',
  )
  return parts.join('\n')
}

// ── background run watcher ──

async function watchRunCompletion(agentSessionId: string, runId: string): Promise<void> {
  try {
    const run = await ChatRuntime.waitForRunCompletion(runId)
    settleTrackedRunCompletion(agentSessionId, runId, run)
  }
 catch (error) {
    const tracked = activeRuns.get(agentSessionId)
    if (tracked?.runId !== runId) {
      return
    }
    activeRuns.delete(agentSessionId)
    AgentInteraction.updateSessionStatus(agentSessionId, 'failed')
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'error',
      body:
        error instanceof Error ? error.message : 'Issue agent run disappeared before completion',
      signal: 'run.failed',
    })
  }
}

function settleTrackedRunCompletion(
  agentSessionId: string,
  runId: string,
  run: Pick<BackendRun, 'status' | 'errorText'>,
): boolean {
  const tracked = activeRuns.get(agentSessionId)
  if (tracked?.runId !== runId) {
    return false
  }
  activeRuns.delete(agentSessionId)

  if (run.status === 'complete') {
    if (tracked.chatSessionId && hasQueuedContinuationWork(tracked.chatSessionId)) {
      startContinuationWatcher({
        agentSessionId,
        chatSessionId: tracked.chatSessionId,
        since: currentUnixSeconds(),
      })
      return true
    }
    AgentInteraction.updateSessionStatus(agentSessionId, 'completed')
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'response',
      body: 'Completed work on issue',
      signal: 'run.completed',
    })
    if (tracked.workId) {
      void prepareWorkAfterCompletion(tracked.workId, agentSessionId)
    }
    return true
  }

  if (run.status === 'failed') {
    AgentInteraction.updateSessionStatus(agentSessionId, 'failed')
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'error',
      body: run.errorText ?? 'Issue agent run failed',
      signal: 'run.failed',
    })
    return true
  }

  AgentInteraction.updateSessionStatus(agentSessionId, 'stopped')
  if (!tracked.aborted) {
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'response',
      body: 'Stopped by user',
      signal: 'run.aborted',
    })
  }
  return true
}


async function prepareWorkAfterCompletion(workId: string, agentSessionId: string): Promise<void> {
  try {
    await Work.prepare({
      id: workId,
      title: 'Completed issue work',
      summary: 'Automatically prepared after issue agent completion.',
      testPlan: 'Reviewed by issue agent.',
    })
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'response',
      body: 'Work prepared for review',
      signal: 'work.prepared',
    })
  }
  catch {
    // prepare can fail if the checkout is clean with no commits ahead —
    // that is fine; the Work is still available for manual preparation.
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'thought',
      body: 'Work auto-prepare skipped (no deliverable changes or already prepared).',
      signal: 'work.prepare.skipped',
    })
  }
}

function hasQueuedContinuationWork(chatSessionId: string): boolean {
  return ChatRuntime.listSessionQueueItems(chatSessionId).some(
    item => item.status === 'pending' || item.status === 'running',
  )
}

function hasChatSessionContinuationWork(chatSessionId: string): boolean {
  const hasActiveRun = ChatRuntime.listActiveRunSummaries().some(
    run => run.sessionId === chatSessionId,
  )
  if (hasActiveRun) {
    return true
  }
  return hasQueuedContinuationWork(chatSessionId)
}

function startContinuationWatcher(input: {
  agentSessionId: string
  chatSessionId: string
  since: number
}): void {
  if (continuationWatchers.has(input.agentSessionId)) {
    return
  }

  const watcher = watchContinuationWork(input)
  continuationWatchers.set(input.agentSessionId, watcher)
  void watcher.finally(() => {
    continuationWatchers.delete(input.agentSessionId)
  })
}

async function watchContinuationWork(input: {
  agentSessionId: string
  chatSessionId: string
  since: number
}): Promise<void> {
  try {
    AgentInteraction.updateSessionStatus(input.agentSessionId, 'active')
    while (hasChatSessionContinuationWork(input.chatSessionId)) {
      await delay(500)
    }

    const session = AgentInteraction.getSession(input.agentSessionId)
    if (!session || session.status === 'stopped') {
      return
    }

    const queueItems = ChatRuntime.listSessionQueueItems(input.chatSessionId).filter(
      item => item.createdAt >= input.since,
    )
    const failedItem = queueItems.find(item => item.status === 'failed')
    if (failedItem) {
      AgentInteraction.updateSessionStatus(input.agentSessionId, 'failed')
      AgentInteraction.createActivity({
        agentSessionId: input.agentSessionId,
        type: 'error',
        body: failedItem.errorText ?? 'Continuation failed',
        signal: 'continuation.failed',
        signalMetadata: {
          chatSessionId: input.chatSessionId,
          queueItemId: failedItem.id,
        },
      })
      return
    }

    AgentInteraction.updateSessionStatus(input.agentSessionId, 'completed')
    AgentInteraction.createActivity({
      agentSessionId: input.agentSessionId,
      type: 'response',
      body: 'Completed queued continuation',
      signal: 'continuation.completed',
      signalMetadata: { chatSessionId: input.chatSessionId },
    })
  }
 catch (error) {
    const session = AgentInteraction.getSession(input.agentSessionId)
    if (!session || session.status === 'stopped') {
      return
    }

    AgentInteraction.updateSessionStatus(input.agentSessionId, 'failed')
    AgentInteraction.createActivity({
      agentSessionId: input.agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : 'Continuation watcher failed',
      signal: 'continuation.failed',
      signalMetadata: { chatSessionId: input.chatSessionId },
    })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function cancelChatSessionContinuationWork(chatSessionId: string): Promise<void> {
  await ChatRuntime.cancelSession(chatSessionId)
  const queueItems = ChatRuntime.listSessionQueueItems(chatSessionId)
  for (const item of queueItems) {
    if (item.status !== 'pending') {
      continue
    }
    try {
      await ChatRuntime.cancelSessionQueueItem(chatSessionId, item.id)
    }
 catch {
      // The queue item may have been claimed by the runtime between list and cancel.
    }
  }
}

// ── run session ──

async function runSession(
  agentSessionId: string,
  options: { runInIsolation?: boolean } = {},
): Promise<void> {
  let trackedRunId = PENDING_RUN_ID
  try {
    if (activeRuns.has(agentSessionId)) {
      throw new AppError({
        code: 'issue_agent_session_in_progress',
        status: 409,
        message: 'Issue agent session already has an active run',
        details: { agentSessionId },
      })
    }
    activeRuns.set(agentSessionId, {
      runId: PENDING_RUN_ID,
      chatSessionId: null,
      aborted: false,
    })

    const session = requireAgentSession(agentSessionId)
    if (!session.agentId) {
      throw new AppError({
        code: 'issue_agent_missing_agent_identity',
        status: 409,
        message: 'Issue agent session is missing agent identity',
        details: { agentSessionId },
      })
    }

    const issue = requireIssue(session.issueId)
    const agent = requireDelegationAgent(session.agentId)
    const workflowRules = await WorkflowRules.get(issue.workspaceId, session.agentId)
    if (consumePendingRunAbort(agentSessionId)) {
      return
    }

    let chatSessionId: string

    if (options.runInIsolation) {
      const workDetail = await Work.create({
        workspaceId: issue.workspaceId,
        title: `Issue: ${issue.title}`,
        objective: buildIssuePrompt(issue, workflowRules),
        linkedIssueId: issue.id,
        providerTargetId: session.providerTargetId,
        modelId: agent.modelId,
        thinkingEffort: agent.thinkingEffort,
        agentId: session.agentId,
        configJson: JSON.stringify({ permissionMode: 'bypassPermissions' }),
      })
      chatSessionId = workDetail.primaryThread.id
      activeRuns.set(agentSessionId, {
        ...activeRuns.get(agentSessionId)!,
        workId: workDetail.work.id,
      })
      if (consumePendingRunAbort(agentSessionId)) {
        return
      }
    } else {
      const created = await Session.create({
        workspaceId: issue.workspaceId,
        title: `Issue: ${issue.title}`,
        origin: 'cradle-issue',
        providerTargetId: session.providerTargetId,
        modelId: agent.modelId,
        thinkingEffort: agent.thinkingEffort,
        agentId: session.agentId,
        linkedIssueId: issue.id,
        configJson: JSON.stringify({ permissionMode: 'bypassPermissions' }),
      })
      chatSessionId = created.id
    }

    AgentInteraction.attachChatSession({ agentSessionId, chatSessionId })
    updateActiveRunChatSession(agentSessionId, chatSessionId)

    AgentInteraction.updateSessionStatus(agentSessionId, 'active')
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'thought',
      body: 'Examining issue...',
      signal: 'run.started',
    })

    const run = await ChatRuntime.createRun({
      sessionId: chatSessionId,
      text: buildIssuePrompt(issue, workflowRules),
    })
    trackedRunId = run.runId

    const tracked = activeRuns.get(agentSessionId)
    if (tracked?.runId !== PENDING_RUN_ID) {
      return
    }
    if (tracked.aborted) {
      activeRuns.delete(agentSessionId)
      await ChatRuntime.abortRun(run.runId)
      return
    }

    activeRuns.set(agentSessionId, {
      runId: run.runId,
      chatSessionId: chatSessionId,
      aborted: false,
    })

    void watchRunCompletion(agentSessionId, run.runId)
  }
 catch (error) {
    const tracked = activeRuns.get(agentSessionId)
    if (tracked?.runId === trackedRunId) {
      activeRuns.delete(agentSessionId)
    }
    AgentInteraction.updateSessionStatus(agentSessionId, 'failed')
    AgentInteraction.createActivity({
      agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : String(error),
      signal: 'run.failed',
    })
  }
}

function updateActiveRunChatSession(agentSessionId: string, chatSessionId: string): void {
  const tracked = activeRuns.get(agentSessionId)
  if (!tracked || tracked.runId !== PENDING_RUN_ID) {
    return
  }
  activeRuns.set(agentSessionId, {
    ...tracked,
    chatSessionId,
  })
}

function consumePendingRunAbort(agentSessionId: string): boolean {
  const tracked = activeRuns.get(agentSessionId)
  if (!tracked?.aborted || tracked.runId !== PENDING_RUN_ID) {
    return false
  }
  activeRuns.delete(agentSessionId)
  return true
}

// ── public API ──

export function getDelegation(issueId: string): IssueAgentDelegationState {
  requireIssue(issueId)
  const latestSession = AgentInteraction.listSessionsForIssue(issueId)[0]
  if (!latestSession) {
    return {
      issueId,
      delegated: false,
      providerTargetId: null,
      agentId: null,
      agentSessionId: null,
      chatSessionId: null,
    }
  }

  const latestActivity = AgentInteraction.listActivities(latestSession.id).at(-1)
  if (latestActivity?.signal === 'delegation.removed') {
    return {
      issueId,
      delegated: false,
      providerTargetId: null,
      agentId: null,
      agentSessionId: null,
      chatSessionId: null,
    }
  }

  return {
    issueId,
    delegated: true,
    providerTargetId: latestSession.providerTargetId,
    agentId: latestSession.agentId,
    agentSessionId: latestSession.id,
    chatSessionId: latestSession.chatSessionId,
  }
}

export function listSessions(issueId: string): IssueAgentSessionView[] {
  requireIssue(issueId)
  const current = getDelegation(issueId)
  return AgentInteraction.listSessionsForIssue(issueId).map(session => ({
    ...session,
    isCurrentDelegation: current.delegated && current.agentSessionId === session.id,
  }))
}

export function listActivities(agentSessionId: string): AgentActivity[] {
  requireAgentSession(agentSessionId)
  return AgentInteraction.listActivities(agentSessionId)
}

export async function enqueueContinuation(input: {
  agentSessionId: string
  mode: ChatRuntime.ChatSessionContinuationMode
  text: string
}): Promise<{
  ok: true
  chatSessionId: string
  continuationId: string
  mode: ChatRuntime.ChatSessionContinuationMode
}> {
  const session = requireAgentSession(input.agentSessionId)
  const text = input.text.trim()
  if (!text) {
    throw new AppError({
      code: 'issue_agent_prompt_empty',
      status: 400,
      message: 'Issue agent continuation requires text',
      details: { agentSessionId: input.agentSessionId },
    })
  }
  if (!session.chatSessionId) {
    throw new AppError({
      code: 'issue_agent_chat_session_not_ready',
      status: 409,
      message: 'Issue agent chat session is not ready',
      details: { agentSessionId: input.agentSessionId },
    })
  }

  if (input.mode === 'steer') {
    const steer = await ChatRuntime.submitSessionSteerTurn({
      sessionId: session.chatSessionId,
      text,
    })

    // The server may auto-fall-back a 'steer' request to queueing (see submitSessionSteerTurn's
    // `mode` discriminant) when the target runtime has no native steer hook or no matching active
    // run — mirror that outcome in the recorded activity/watcher instead of assuming it steered.
    if (steer.mode === 'queued') {
      startContinuationWatcher({
        agentSessionId: session.id,
        chatSessionId: session.chatSessionId,
        since: steer.queueItem.createdAt,
      })

      AgentInteraction.createActivity({
        agentSessionId: session.id,
        type: 'prompt',
        body: text,
        signal: 'continuation.queued',
        signalMetadata: {
          chatSessionId: session.chatSessionId,
          continuationId: steer.queueItem.id,
          mode: 'queue',
        },
      })

      return {
        ok: true,
        chatSessionId: session.chatSessionId,
        continuationId: steer.queueItem.id,
        mode: 'queue',
      }
    }

    AgentInteraction.createActivity({
      agentSessionId: session.id,
      type: 'prompt',
      body: text,
      signal: 'continuation.steer',
      signalMetadata: {
        chatSessionId: session.chatSessionId,
        continuationId: steer.message.id,
        mode: input.mode,
      },
    })

    return {
      ok: true,
      chatSessionId: session.chatSessionId,
      continuationId: steer.message.id,
      mode: input.mode,
    }
  }

  const queueItem = await ChatRuntime.enqueueSessionQueueItem({
    sessionId: session.chatSessionId,
    text,
  })

  AgentInteraction.createActivity({
    agentSessionId: session.id,
    type: 'prompt',
    body: text,
    signal: 'continuation.queued',
    signalMetadata: {
      chatSessionId: session.chatSessionId,
      continuationId: queueItem.id,
      mode: input.mode,
    },
  })

  startContinuationWatcher({
    agentSessionId: session.id,
    chatSessionId: session.chatSessionId,
    since: queueItem.createdAt,
  })

  return {
    ok: true,
    chatSessionId: session.chatSessionId,
    continuationId: queueItem.id,
    mode: input.mode,
  }
}

export async function delegateIssue(input: {
  issueId: string
  agentId: string
  providerTargetId?: string | null
  runInIsolation?: boolean
}): Promise<IssueAgentSessionView> {
  requireIssue(input.issueId)
  const agent = requireDelegationAgent(input.agentId)
  if (input.providerTargetId && input.providerTargetId !== agent.providerTargetId) {
    throw new AppError({
      code: 'issue_agent_identity_mismatch',
      status: 400,
      message: 'Provider target does not match the selected agent',
      details: {
        agentId: input.agentId,
        providerTargetId: input.providerTargetId,
        expectedProviderTargetId: agent.providerTargetId,
      },
    })
  }

  const target = requireProviderTarget(agent.providerTargetId)
  if (!target.enabled) {
    throw new AppError({
      code: 'issue_agent_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: { providerTargetId: agent.providerTargetId },
    })
  }

  const currentDelegation = getDelegation(input.issueId)
  if (currentDelegation.agentSessionId && activeRuns.has(currentDelegation.agentSessionId)) {
    throw new AppError({
      code: 'issue_agent_delegation_in_progress',
      status: 409,
      message: 'Issue already has an active delegated run',
      details: {
        issueId: input.issueId,
        agentSessionId: currentDelegation.agentSessionId,
      },
    })
  }

  const session = db().transaction(() => {
    Issue.updateIssueDelegation(input.issueId, {
      agentId: agent.id,
      providerTargetId: agent.providerTargetId,
    })

    // Add system comment to activity timeline
    Issue.addComment({
      issueId: input.issueId,
      content: `Delegated to ${agent.name}`,
      authorKind: 'system.delegated',
    })

    const createdSession = AgentInteraction.createSession({
      issueId: input.issueId,
      providerTargetId: agent.providerTargetId,
      agentId: agent.id,
    })

    AgentInteraction.createActivity({
      agentSessionId: createdSession.id,
      type: 'response',
      body: `Delegated to ${agent.name}`,
      signal: 'delegation.created',
      signalMetadata: { providerTargetId: agent.providerTargetId, agentId: agent.id },
    })

    return createdSession
  })

  void runSession(session.id, { runInIsolation: input.runInIsolation })

  return { ...session, isCurrentDelegation: true }
}

export async function rerunSession(input: {
  agentSessionId: string
}): Promise<IssueAgentSessionView> {
  const session = requireAgentSession(input.agentSessionId)
  if (activeRuns.has(session.id)) {
    throw new AppError({
      code: 'issue_agent_session_in_progress',
      status: 409,
      message: 'Issue agent session already has an active run',
      details: { agentSessionId: session.id },
    })
  }

  const refreshed = AgentInteraction.updateSessionStatus(session.id, 'created') ?? session
  void runSession(session.id)

  const delegation = getDelegation(session.issueId)
  return { ...refreshed, isCurrentDelegation: delegation.agentSessionId === session.id }
}

export async function undelegateIssue(issueId: string): Promise<void> {
  requireIssue(issueId)
  const state = getDelegation(issueId)
  if (!state.delegated || !state.agentSessionId) {
    return
  }

  const run = activeRuns.get(state.agentSessionId)
  if (run) {
    run.aborted = true
    if (run.chatSessionId) {
      await cancelChatSessionContinuationWork(run.chatSessionId)
    }
    AgentInteraction.updateSessionStatus(state.agentSessionId, 'stopped')
  }
 else if (state.chatSessionId) {
    await cancelChatSessionContinuationWork(state.chatSessionId)
    AgentInteraction.updateSessionStatus(state.agentSessionId, 'stopped')
  }

  Issue.updateIssueDelegation(issueId, null)

  // Add system comment to activity timeline
  Issue.addComment({ issueId, content: 'Delegation removed', authorKind: 'system.undelegated' })

  AgentInteraction.createActivity({
    agentSessionId: state.agentSessionId,
    type: 'response',
    body: 'Delegation removed',
    signal: 'delegation.removed',
  })
}

export async function stopSession(agentSessionId: string): Promise<void> {
  const session = requireAgentSession(agentSessionId)
  const run = activeRuns.get(agentSessionId)
  if (run) {
    run.aborted = true
    if (run.chatSessionId) {
      await cancelChatSessionContinuationWork(run.chatSessionId)
    }
  }
 else if (session.chatSessionId) {
    await cancelChatSessionContinuationWork(session.chatSessionId)
  }
  AgentInteraction.updateSessionStatus(agentSessionId, 'stopped')
  AgentInteraction.createActivity({
    agentSessionId,
    type: 'response',
    body: 'Session stopped by user',
    signal: 'run.aborted',
  })
}

export const issueAgentRunTrackingTestHooks = {
  setActiveRun(agentSessionId: string, run: ActiveAgentRun): void {
    activeRuns.set(agentSessionId, run)
  },
  getActiveRun(agentSessionId: string): ActiveAgentRun | undefined {
    return activeRuns.get(agentSessionId)
  },
  clearActiveRuns(): void {
    activeRuns.clear()
  },
  settleRunCompletion(
    agentSessionId: string,
    runId: string,
    run: Pick<BackendRun, 'status' | 'errorText'>,
  ): boolean {
    return settleTrackedRunCompletion(agentSessionId, runId, run)
  },
}
