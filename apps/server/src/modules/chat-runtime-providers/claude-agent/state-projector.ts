/**
 * Output: Claude Agent provider snapshot projections for session-local runtime state.
 * Input: workspace provider snapshots and requested model ids.
 * Position: Claude Agent provider package owner for providerStateSnapshot updates.
 */

import type { AccountInfo, SDKAuthStatusMessage, SDKPermissionDeniedMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'

import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import type { RuntimeAlertItem, RuntimeAlertUiSlotState, RuntimeCrewAgentItem, RuntimeCrewCallItem, RuntimeCrewUiSlotState, RuntimePlanStepStatus, RuntimePlanUiSlotState, RuntimeProgressUiSlotState, RuntimeSession, RuntimeToolActivityItem, RuntimeToolActivityUiSlotState, RuntimeUsageUiSlotState } from '../../chat-runtime/runtime-provider-types'
import type { WorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import { readWorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import type { ClaudeAgentCapturedPlan, ClaudeAgentCapturedTaskActivity, ClaudeAgentCapturedTodos } from './event-to-chunk-mapper'
import type { TodoPluginItem, TodoPluginStatus } from './tools/todo-plugin-state'
import type { ClaudeWorkflowExecutionRecord } from './workflow'
import { mergeClaudeWorkflowExecutionRecord, readClaudeWorkflowExecutionRecord } from './workflow'

interface ClaudeAgentPlanSnapshot {
  threadId: string
  turnId: string
  content: string
  steps: Array<{ step: string, status: RuntimePlanStepStatus }>
  updatedAt: number
}

interface ClaudeAgentProgressSnapshot {
  threadId: string
  turnId: string
  source: string
  items: TodoPluginItem[]
  updatedAt: number
}

interface ClaudeAgentAccountSnapshot {
  threadId: string
  email: string | null
  organization: string | null
  subscriptionType: string | null
  tokenSource: string | null
  apiKeySource: string | null
  apiProvider: AccountInfo['apiProvider'] | null
  updatedAt: number
}

interface ClaudeAgentAuthStatusSnapshot {
  threadId: string
  isAuthenticating: boolean
  output: string[]
  error: string | null
  updatedAt: number
}

interface ClaudeAgentRateLimitSnapshot {
  threadId: string
  info: SDKRateLimitInfo
  updatedAt: number
}

interface ClaudeAgentAlertSnapshot {
  threadId: string
  items: RuntimeAlertItem[]
  updatedAt: number
}

const CLAUDE_AGENT_RECENT_ALERT_LIMIT = 12

export const CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID = '__cradle_claude_runtime_default__'

export function resolveClaudeAgentPendingModelSwitchId(snapshot: WorkspaceProviderStateSnapshot, requestedModelId: string | null): string | null {
  const existingPendingModelSwitchId = readClaudeAgentPendingModelSwitchId(snapshot)
  if (requestedModelId === null) {
    return snapshot.models.currentModelId === null ? null : CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID
  }
  if (requestedModelId !== snapshot.models.currentModelId) {
    return requestedModelId
  }
  return existingPendingModelSwitchId === requestedModelId ? existingPendingModelSwitchId : null
}

export function readClaudeAgentPendingModelSwitchId(snapshot: WorkspaceProviderStateSnapshot): string | null {
  const claudeAgentState = readRecord(snapshot.claudeAgent)
  const pendingModelSwitchId = typeof claudeAgentState.pendingModelSwitchId === 'string'
    ? claudeAgentState.pendingModelSwitchId.trim()
    : ''
  return pendingModelSwitchId || null
}

export function writeClaudeAgentPendingModelSwitch(
  snapshot: WorkspaceProviderStateSnapshot,
  pendingModelSwitchId: string | null,
): WorkspaceProviderStateSnapshot {
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  if (pendingModelSwitchId) {
    claudeAgentState.pendingModelSwitchId = pendingModelSwitchId
  }
  else {
    delete claudeAgentState.pendingModelSwitchId
  }

  const nextSnapshot: WorkspaceProviderStateSnapshot = { ...snapshot }
  if (Object.keys(claudeAgentState).length > 0) {
    nextSnapshot.claudeAgent = claudeAgentState
  }
  else {
    delete nextSnapshot.claudeAgent
  }
  return nextSnapshot
}

export function clearClaudeAgentPendingModelSwitch(runtimeSession: RuntimeSession): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify(writeClaudeAgentPendingModelSwitch(snapshot, null))
}

export function clearClaudeAgentCapturedPlan(runtimeSession: RuntimeSession): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  delete claudeAgentState.plan

  const nextSnapshot: WorkspaceProviderStateSnapshot = { ...snapshot }
  if (Object.keys(claudeAgentState).length > 0) {
    nextSnapshot.claudeAgent = claudeAgentState
  }
  else {
    delete nextSnapshot.claudeAgent
  }
  runtimeSession.providerStateSnapshot = JSON.stringify(nextSnapshot)
}

export function clearClaudeAgentProgress(runtimeSession: RuntimeSession): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  delete claudeAgentState.progress

  const nextSnapshot: WorkspaceProviderStateSnapshot = { ...snapshot }
  if (Object.keys(claudeAgentState).length > 0) {
    nextSnapshot.claudeAgent = claudeAgentState
  }
  else {
    delete nextSnapshot.claudeAgent
  }
  runtimeSession.providerStateSnapshot = JSON.stringify(nextSnapshot)
}

export function writeClaudeAgentCapturedPlan(runtimeSession: RuntimeSession, plan: ClaudeAgentCapturedPlan, updatedAt: number = Date.now()): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    plan: {
      threadId: runtimeSession.chatSessionId,
      turnId: plan.toolCallId,
      content: plan.content,
      steps: projectPlanSteps(plan.content),
      updatedAt,
    } satisfies ClaudeAgentPlanSnapshot,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function writeClaudeAgentProgress(runtimeSession: RuntimeSession, progress: ClaudeAgentCapturedTodos, updatedAt: number = Date.now()): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    progress: {
      threadId: runtimeSession.chatSessionId,
      turnId: progress.toolCallId,
      source: progress.source ?? 'TodoWrite',
      items: progress.todos,
      updatedAt,
    } satisfies ClaudeAgentProgressSnapshot,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function projectClaudeAgentPlanUiSlotState(runtimeSession: RuntimeSession): RuntimePlanUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const plan = readClaudeAgentPlanSnapshot(snapshot)
  if (!plan || plan.threadId !== runtimeSession.chatSessionId) {
    return null
  }
  const pendingCount = plan.steps.filter(step => step.status === 'pending').length
  const inProgressCount = plan.steps.filter(step => step.status === 'inProgress').length
  const completedCount = plan.steps.filter(step => step.status === 'completed').length
  return {
    kind: 'plan',
    slotId: 'claude-agent:plan',
    threadId: plan.threadId,
    turnId: plan.turnId,
    explanation: null,
    content: plan.content,
    steps: plan.steps,
    currentStep: plan.steps.find(step => step.status === 'inProgress')?.step
      ?? plan.steps.find(step => step.status === 'pending')?.step
      ?? null,
    pendingCount,
    inProgressCount,
    completedCount,
    updatedAt: plan.updatedAt,
  }
}

export function projectClaudeAgentProgressUiSlotState(runtimeSession: RuntimeSession): RuntimeProgressUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const progress = readClaudeAgentProgressSnapshot(snapshot)
  if (!progress || progress.threadId !== runtimeSession.chatSessionId) {
    return null
  }
  const items = progress.items.map(item => ({
    id: item.id,
    label: item.content,
    status: mapTodoPluginStatusToRuntimeStatus(item.status),
    sourceStatus: item.sourceStatus,
  }))
  const pendingCount = items.filter(item => item.status === 'pending').length
  const inProgressCount = items.filter(item => item.status === 'inProgress').length
  const completedCount = items.filter(item => item.status === 'completed').length
  return {
    kind: 'progress',
    slotId: 'claude-agent:progress',
    threadId: progress.threadId,
    turnId: progress.turnId,
    source: progress.source,
    items,
    currentItem: items.find(item => item.status === 'inProgress')?.label
      ?? items.find(item => item.status === 'pending')?.label
      ?? null,
    pendingCount,
    inProgressCount,
    completedCount,
    updatedAt: progress.updatedAt,
  }
}

export function writeClaudeAgentAccountSnapshot(
  runtimeSession: RuntimeSession,
  account: AccountInfo,
  updatedAt: number = Date.now(),
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    account: {
      threadId: runtimeSession.chatSessionId,
      email: account.email ?? null,
      organization: account.organization ?? null,
      subscriptionType: account.subscriptionType ?? null,
      tokenSource: account.tokenSource ?? null,
      apiKeySource: account.apiKeySource ?? null,
      apiProvider: account.apiProvider ?? null,
      updatedAt,
    } satisfies ClaudeAgentAccountSnapshot,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function writeClaudeAgentAuthStatusSnapshot(
  runtimeSession: RuntimeSession,
  message: SDKAuthStatusMessage,
  updatedAt: number = Date.now(),
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    authStatus: {
      threadId: runtimeSession.chatSessionId,
      isAuthenticating: message.isAuthenticating,
      output: message.output,
      error: message.error ?? null,
      updatedAt,
    } satisfies ClaudeAgentAuthStatusSnapshot,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function writeClaudeAgentRateLimitSnapshot(
  runtimeSession: RuntimeSession,
  info: SDKRateLimitInfo,
  updatedAt: number = Date.now(),
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    rateLimit: {
      threadId: runtimeSession.chatSessionId,
      info,
      updatedAt,
    } satisfies ClaudeAgentRateLimitSnapshot,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function writeClaudeAgentPermissionDeniedSnapshot(
  runtimeSession: RuntimeSession,
  message: SDKPermissionDeniedMessage,
  updatedAt: number = Date.now(),
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  const previous = readClaudeAgentAlertSnapshot(claudeAgentState.alert)
  const id = `permission-denied:${message.tool_use_id}`
  const item: RuntimeAlertItem = {
    id,
    severity: 'warning',
    message: message.decision_reason?.trim() || message.message,
    source: `Claude ${message.tool_name}`,
    updatedAt,
  }
  const items = [
    item,
    ...(previous?.items.filter(candidate => candidate.id !== id) ?? []),
  ].slice(0, CLAUDE_AGENT_RECENT_ALERT_LIMIT)

  claudeAgentState.alert = {
    threadId: runtimeSession.chatSessionId,
    items,
    updatedAt,
  } satisfies ClaudeAgentAlertSnapshot
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function projectClaudeAgentAlertUiSlotState(runtimeSession: RuntimeSession): RuntimeAlertUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const alert = readClaudeAgentAlertSnapshot(readRecord(snapshot.claudeAgent).alert)
  if (!alert || alert.threadId !== runtimeSession.chatSessionId || alert.items.length === 0) {
    return null
  }
  return {
    kind: 'alert',
    slotId: 'claude-agent:alerts',
    threadId: alert.threadId,
    warningCount: alert.items.filter(item => item.severity === 'warning').length,
    errorCount: alert.items.filter(item => item.severity === 'error').length,
    recentItems: alert.items,
    updatedAt: alert.updatedAt,
  }
}

export function projectClaudeAgentUsageUiSlotState(runtimeSession: RuntimeSession): RuntimeUsageUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = readRecord(snapshot.claudeAgent)
  const account = readClaudeAgentAccountSnapshot(claudeAgentState.account)
  const rateLimit = readClaudeAgentRateLimitSnapshot(claudeAgentState.rateLimit)
  if (!account && !rateLimit) {
    return null
  }
  const info = rateLimit?.info
  return {
    kind: 'usage',
    slotId: 'claude-agent:usage',
    threadId: runtimeSession.chatSessionId,
    limitName: info?.rateLimitType ?? info?.status ?? null,
    usedPercent: info?.utilization ?? null,
    primaryWindowDurationMins: null,
    primaryResetsAt: info?.resetsAt ?? null,
    secondaryUsedPercent: null,
    secondaryWindowDurationMins: null,
    secondaryResetsAt: info?.overageResetsAt ?? null,
    creditsBalance: null,
    hasCredits: info?.errorCode === 'credits_required' ? false : null,
    rateLimitReachedType: info?.status === 'rejected'
      ? info.errorCode ?? info.rateLimitType ?? info.status
      : null,
    planType: account?.subscriptionType ?? null,
    updatedAt: Math.max(account?.updatedAt ?? 0, rateLimit?.updatedAt ?? 0),
  }
}

function readClaudeAgentPlanSnapshot(snapshot: WorkspaceProviderStateSnapshot): ClaudeAgentPlanSnapshot | null {
  const plan = readRecord(readRecord(snapshot.claudeAgent).plan)
  const threadId = typeof plan.threadId === 'string' ? plan.threadId : ''
  const turnId = typeof plan.turnId === 'string' ? plan.turnId : ''
  const content = typeof plan.content === 'string' ? plan.content.trim() : ''
  const updatedAt = typeof plan.updatedAt === 'number' ? plan.updatedAt : 0
  if (!threadId || !turnId || !content || updatedAt <= 0) {
    return null
  }
  return {
    threadId,
    turnId,
    content,
    steps: readClaudeAgentPlanSteps(plan.steps, content),
    updatedAt,
  }
}

function readClaudeAgentProgressSnapshot(snapshot: WorkspaceProviderStateSnapshot): ClaudeAgentProgressSnapshot | null {
  const progress = readRecord(readRecord(snapshot.claudeAgent).progress)
  const threadId = typeof progress.threadId === 'string' ? progress.threadId : ''
  const turnId = typeof progress.turnId === 'string' ? progress.turnId : ''
  const source = typeof progress.source === 'string' ? progress.source.trim() : ''
  const updatedAt = typeof progress.updatedAt === 'number' ? progress.updatedAt : 0
  const items = readClaudeAgentProgressItems(progress.items)
  if (!threadId || !turnId || !source || items.length === 0 || updatedAt <= 0) {
    return null
  }
  return {
    threadId,
    turnId,
    source,
    items,
    updatedAt,
  }
}

function readClaudeAgentAccountSnapshot(value: unknown): ClaudeAgentAccountSnapshot | null {
  const account = readRecord(value)
  const threadId = typeof account.threadId === 'string' ? account.threadId : ''
  const updatedAt = typeof account.updatedAt === 'number' ? account.updatedAt : 0
  if (!threadId || updatedAt <= 0) {
    return null
  }
  return {
    threadId,
    email: typeof account.email === 'string' ? account.email : null,
    organization: typeof account.organization === 'string' ? account.organization : null,
    subscriptionType: typeof account.subscriptionType === 'string' ? account.subscriptionType : null,
    tokenSource: typeof account.tokenSource === 'string' ? account.tokenSource : null,
    apiKeySource: typeof account.apiKeySource === 'string' ? account.apiKeySource : null,
    apiProvider: isClaudeAgentApiProvider(account.apiProvider) ? account.apiProvider : null,
    updatedAt,
  }
}

function readClaudeAgentRateLimitSnapshot(value: unknown): ClaudeAgentRateLimitSnapshot | null {
  const rateLimit = readRecord(value)
  const threadId = typeof rateLimit.threadId === 'string' ? rateLimit.threadId : ''
  const updatedAt = typeof rateLimit.updatedAt === 'number' ? rateLimit.updatedAt : 0
  const info = readRecord(rateLimit.info) as Partial<SDKRateLimitInfo>
  if (!threadId || updatedAt <= 0 || !isClaudeAgentRateLimitStatus(info.status)) {
    return null
  }
  return {
    threadId,
    info: {
      ...info,
      status: info.status,
    },
    updatedAt,
  }
}

function readClaudeAgentAlertSnapshot(value: unknown): ClaudeAgentAlertSnapshot | null {
  const alert = readRecord(value)
  const threadId = typeof alert.threadId === 'string' ? alert.threadId : ''
  const updatedAt = typeof alert.updatedAt === 'number' ? alert.updatedAt : 0
  const items = Array.isArray(alert.items)
    ? alert.items.flatMap((value): RuntimeAlertItem[] => {
        const item = readRecord(value)
        if (
          typeof item.id !== 'string'
          || (item.severity !== 'warning' && item.severity !== 'error')
          || typeof item.message !== 'string'
          || typeof item.source !== 'string'
          || typeof item.updatedAt !== 'number'
        ) {
          return []
        }
        return [{
          id: item.id,
          severity: item.severity,
          message: item.message,
          source: item.source,
          updatedAt: item.updatedAt,
        }]
      })
    : []
  if (!threadId || updatedAt <= 0 || items.length === 0) {
    return null
  }
  return { threadId, items, updatedAt }
}

function isClaudeAgentRateLimitStatus(value: unknown): value is SDKRateLimitInfo['status'] {
  return value === 'allowed' || value === 'allowed_warning' || value === 'rejected'
}

function isClaudeAgentApiProvider(value: unknown): value is NonNullable<AccountInfo['apiProvider']> {
  return value === 'firstParty'
    || value === 'bedrock'
    || value === 'vertex'
    || value === 'foundry'
    || value === 'anthropicAws'
    || value === 'mantle'
    || value === 'gateway'
}

function readClaudeAgentProgressItems(value: unknown): TodoPluginItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): TodoPluginItem[] => {
    const record = readRecord(item)
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    const status = record.status
    if (!content || !isTodoPluginStatus(status)) {
      return []
    }
    return [{
      id: typeof record.id === 'string' ? record.id : null,
      content,
      status,
      sourceStatus: typeof record.sourceStatus === 'string' ? record.sourceStatus : null,
    }]
  })
}

function readClaudeAgentPlanSteps(value: unknown, content: string): ClaudeAgentPlanSnapshot['steps'] {
  if (!Array.isArray(value)) {
    return projectPlanSteps(content)
  }
  const steps = value.flatMap((item): ClaudeAgentPlanSnapshot['steps'] => {
    const record = readRecord(item)
    const step = typeof record.step === 'string' ? record.step.trim() : ''
    const status = record.status
    return step && isRuntimePlanStepStatus(status) ? [{ step, status }] : []
  })
  return steps.length > 0 ? steps : projectPlanSteps(content)
}

function projectPlanSteps(content: string): ClaudeAgentPlanSnapshot['steps'] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(step => ({ step, status: 'pending' }))
}

function isRuntimePlanStepStatus(value: unknown): value is RuntimePlanStepStatus {
  return value === 'pending' || value === 'inProgress' || value === 'completed'
}

function isTodoPluginStatus(value: unknown): value is TodoPluginStatus {
  return value === 'todo' || value === 'processing' || value === 'completed'
}

function mapTodoPluginStatusToRuntimeStatus(status: TodoPluginStatus): RuntimePlanStepStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'processing':
      return 'inProgress'
    case 'todo':
    default:
      return 'pending'
  }
}

// ── Crew State ────────────────────────────────────────────────────────────────

interface ClaudeAgentCrewCallSnapshot {
  id: string
  agentId: string | null
  tool: string
  prompt: string | null
  description: string | null
  subagentType: string | null
  model: string | null
  reasoningEffort: string | null
  tools: string[]
  outputFile: string | null
  runInBackground: boolean
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt: number | null
}

export function writeClaudeAgentCrewCall(
  runtimeSession: RuntimeSession,
  call: ClaudeAgentCrewCallSnapshot,
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  const existingCalls = readClaudeAgentCrewCallsSnapshot(claudeAgentState.crewCalls)

  // Upsert: update existing call or append new one
  const index = existingCalls.findIndex(c => c.id === call.id || (call.agentId !== null && c.agentId === call.agentId))
  if (index >= 0) {
    existingCalls[index] = mergeClaudeAgentCrewCall(existingCalls[index]!, call)
  }
  else {
    existingCalls.push(call)
  }

  claudeAgentState.crewCalls = existingCalls
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function writeClaudeAgentWorkflowExecution(
  runtimeSession: RuntimeSession,
  execution: ClaudeWorkflowExecutionRecord,
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  const existingExecutions = readClaudeAgentWorkflowExecutionsSnapshot(claudeAgentState.workflowExecutions)
  const index = existingExecutions.findIndex(item => item.toolCallId === execution.toolCallId)

  if (index >= 0) {
    existingExecutions[index] = mergeClaudeWorkflowExecutionRecord(existingExecutions[index]!, execution)
  }
  else {
    existingExecutions.push(execution)
  }

  claudeAgentState.workflowExecutions = existingExecutions
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function readClaudeAgentWorkflowExecutions(
  runtimeSession: RuntimeSession,
): ClaudeWorkflowExecutionRecord[] {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  return readClaudeAgentWorkflowExecutionsSnapshot(readRecord(snapshot.claudeAgent).workflowExecutions)
}

function readClaudeAgentWorkflowExecutionsSnapshot(value: unknown): ClaudeWorkflowExecutionRecord[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): ClaudeWorkflowExecutionRecord[] => {
    const execution = readClaudeWorkflowExecutionRecord(item)
    return execution ? [execution] : []
  })
}

export function projectClaudeAgentCrewUiSlotState(
  runtimeSession: RuntimeSession,
): RuntimeCrewUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const calls = readClaudeAgentCrewCallsSnapshot(readRecord(snapshot.claudeAgent).crewCalls)
  if (calls.length === 0) {
    return null
  }

  const activeCount = calls.filter(c => c.status === 'running').length
  const completedCount = calls.filter(c => c.status === 'completed').length
  const failedCount = calls.filter(c => c.status === 'failed').length

  const crewCalls: RuntimeCrewCallItem[] = calls.map(call => ({
    id: call.id,
    tool: call.tool,
    status: call.status,
    senderThreadId: runtimeSession.chatSessionId,
    receiverThreadIds: readClaudeAgentReceiverThreadIds(call),
    prompt: call.description ?? call.prompt,
    model: call.model,
    reasoningEffort: call.reasoningEffort,
    agents: projectClaudeAgentCrewAgents(call),
    startedAt: call.startedAt,
    completedAt: call.completedAt,
  }))

  const recentItems: RuntimeToolActivityItem[] = calls.map(call => ({
    id: call.id,
    type: 'agentToolCall',
    label: call.description ?? call.prompt ?? call.subagentType ?? call.tool,
    status: call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
  }))

  // Build agent list from calls so completed subagent transcripts stay readable
  // from the runtime panel after the active stream has finished.
  const agents: RuntimeCrewAgentItem[] = calls
    .flatMap(projectClaudeAgentCrewAgents)

  return {
    kind: 'crew',
    slotId: 'claude-agent:crew',
    threadId: runtimeSession.chatSessionId,
    activeCount,
    completedCount,
    failedCount,
    recentItems,
    agents,
    collaborationModeCount: 0,
    collaborationModes: [],
    calls: crewCalls,
    updatedAt: Date.now(),
  }
}

export function readClaudeAgentCrewProviderThreadIdForAgent(
  runtimeSession: RuntimeSession,
  agentId: string,
): string | null {
  const normalizedAgentId = agentId.trim()
  if (!normalizedAgentId) {
    return null
  }

  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const calls = readClaudeAgentCrewCallsSnapshot(readRecord(snapshot.claudeAgent).crewCalls)
  const call = calls.find(item => item.agentId === normalizedAgentId)
  return call?.id ?? null
}

function mergeClaudeAgentCrewCall(
  existing: ClaudeAgentCrewCallSnapshot,
  next: ClaudeAgentCrewCallSnapshot,
): ClaudeAgentCrewCallSnapshot {
  return {
    id: existing.id,
    agentId: next.agentId ?? existing.agentId,
    tool: mergeClaudeAgentCrewTool(existing.tool, next.tool),
    prompt: next.prompt ?? existing.prompt,
    description: next.description ?? existing.description,
    subagentType: next.subagentType ?? existing.subagentType,
    model: next.model ?? existing.model,
    reasoningEffort: next.reasoningEffort ?? existing.reasoningEffort,
    tools: next.tools.length > 0 ? next.tools : existing.tools,
    outputFile: next.outputFile ?? existing.outputFile,
    runInBackground: next.runInBackground || existing.runInBackground,
    status: next.status,
    startedAt: next.startedAt > 0 ? next.startedAt : existing.startedAt,
    completedAt: next.completedAt ?? existing.completedAt,
  }
}

function mergeClaudeAgentCrewTool(existing: string, next: string): string {
  if (existing === 'Workflow' && next === 'Agent') {
    return existing
  }
  return next || existing
}

function readClaudeAgentCrewCallsSnapshot(value: unknown): ClaudeAgentCrewCallSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): ClaudeAgentCrewCallSnapshot[] => {
    const record = readRecord(item)
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const tool = typeof record.tool === 'string' ? record.tool.trim() : ''
    const status = record.status
    if (!id || !tool || (status !== 'running' && status !== 'completed' && status !== 'failed')) {
      return []
    }
    return [{
      id,
      agentId: typeof record.agentId === 'string' ? record.agentId : null,
      tool,
      prompt: typeof record.prompt === 'string' ? record.prompt : null,
      description: typeof record.description === 'string' ? record.description : null,
      subagentType: typeof record.subagentType === 'string' ? record.subagentType : null,
      model: typeof record.model === 'string' ? record.model : null,
      reasoningEffort: typeof record.reasoningEffort === 'string' ? record.reasoningEffort : null,
      tools: Array.isArray(record.tools) ? record.tools.filter((tool): tool is string => typeof tool === 'string') : [],
      outputFile: typeof record.outputFile === 'string' ? record.outputFile : null,
      runInBackground: record.runInBackground === true,
      status,
      startedAt: typeof record.startedAt === 'number' ? record.startedAt : 0,
      completedAt: typeof record.completedAt === 'number' ? record.completedAt : null,
    }]
  })
}

function readClaudeAgentReceiverThreadIds(call: ClaudeAgentCrewCallSnapshot): string[] {
  if (call.tool !== 'Agent') {
    return []
  }
  return [call.id]
}

function projectClaudeAgentCrewAgents(call: ClaudeAgentCrewCallSnapshot): RuntimeCrewAgentItem[] {
  if (call.tool !== 'Agent') {
    return []
  }
  return [{
    threadId: call.id,
    status: call.status,
    message: call.description ?? call.prompt,
    name: call.subagentType,
    preview: (call.description ?? call.prompt)?.slice(0, 120) ?? null,
    modelProvider: call.model,
    agentNickname: call.subagentType,
    agentRole: call.description ?? call.prompt,
  }]
}

// ── Task Activity State ─────────────────────────────────────────────────────
//
// Background `task_*` lifecycle events that are not linked to a real `Agent`/`Workflow`
// tool_use are projected here instead of into the crew store — see `resolveClaudeLinkedCrewTool`
// in `event-to-chunk-mapper.ts`. This keeps generic runtime task progress (e.g. a `Bash` call
// that happens to carry a `description`) out of the Subagent UI.

interface ClaudeAgentTaskActivitySnapshot {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number | null
  completedAt: number | null
}

export function writeClaudeAgentTaskActivity(
  runtimeSession: RuntimeSession,
  item: ClaudeAgentCapturedTaskActivity,
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  const existingItems = readClaudeAgentTaskActivitySnapshot(claudeAgentState.taskActivity)

  const index = existingItems.findIndex(existing => existing.id === item.id)
  if (index >= 0) {
    existingItems[index] = mergeClaudeAgentTaskActivity(existingItems[index]!, item)
  }
  else {
    existingItems.push(item)
  }

  claudeAgentState.taskActivity = existingItems
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function projectClaudeAgentToolActivityUiSlotState(
  runtimeSession: RuntimeSession,
): RuntimeToolActivityUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const items = readClaudeAgentTaskActivitySnapshot(readRecord(snapshot.claudeAgent).taskActivity)
  if (items.length === 0) {
    return null
  }

  const recentItems: RuntimeToolActivityItem[] = items.map(item => ({
    id: item.id,
    type: 'backgroundTask',
    label: item.label,
    status: item.status,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
  }))

  return {
    kind: 'toolActivity',
    slotId: 'claude-agent:tool-activity',
    threadId: runtimeSession.chatSessionId,
    turnId: null,
    activeCount: items.filter(item => item.status === 'running').length,
    completedCount: items.filter(item => item.status === 'completed').length,
    failedCount: items.filter(item => item.status === 'failed').length,
    recentItems,
    updatedAt: Date.now(),
  }
}

function mergeClaudeAgentTaskActivity(
  existing: ClaudeAgentTaskActivitySnapshot,
  next: ClaudeAgentCapturedTaskActivity,
): ClaudeAgentTaskActivitySnapshot {
  return {
    id: existing.id,
    label: next.label || existing.label,
    status: next.status,
    startedAt: next.startedAt ?? existing.startedAt,
    completedAt: next.completedAt ?? existing.completedAt,
  }
}

function readClaudeAgentTaskActivitySnapshot(value: unknown): ClaudeAgentTaskActivitySnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): ClaudeAgentTaskActivitySnapshot[] => {
    const record = readRecord(item)
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const status = record.status
    if (!id || (status !== 'running' && status !== 'completed' && status !== 'failed')) {
      return []
    }
    return [{
      id,
      label: typeof record.label === 'string' ? record.label : id,
      status,
      startedAt: typeof record.startedAt === 'number' ? record.startedAt : null,
      completedAt: typeof record.completedAt === 'number' ? record.completedAt : null,
    }]
  })
}
