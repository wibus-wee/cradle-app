import type { UIMessage, UIMessageChunk } from 'ai'

export const providerKinds = ['openai-compatible', 'anthropic', 'universal'] as const
export type ProviderKind = (typeof providerKinds)[number]
export const providerTargetKinds = ['manual', 'external'] as const
export type ProviderTargetKind = (typeof providerTargetKinds)[number]
export type RuntimeKind = string

export interface RuntimeModelCapabilities {
  contextWindow?: number
  maxOutput?: number
  inputModalities?: string[]
  outputModalities?: string[]
  reasoning?: boolean
  reasoningEfforts?: Array<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>
  toolCall?: boolean
  temperature?: boolean
  structuredOutput?: boolean
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  family?: string
  knowledgeCutoff?: string
  releaseDate?: string
  registryMatch?: 'exact' | 'fuzzy' | 'manual' | 'alias' | 'unmatched'
  registryModelId?: string
  registryModelLabel?: string
}

export interface RuntimeModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  capabilities: RuntimeModelCapabilities
  runtimeKind: RuntimeKind
  source: 'runtime' | 'runtime-cache' | 'opencode-sdk' | 'opencode-cli' | 'fallback'
  nativeProviderId?: string
}

export interface RuntimeModelCatalog {
  runtimeKind: RuntimeKind
  source: RuntimeModelDescriptor['source']
  fetchedAt: number
  models: RuntimeModelDescriptor[]
}

export interface ListRuntimeModelsInput {
  workspacePath?: string
}

export type RuntimeObservabilitySeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type RuntimeObservabilityCategory
  = | 'chat'
    | 'provider'
    | 'event-bus'
    | 'ipc'
    | 'system'
    | 'performance'
    | 'diagnostics'
export type RuntimeObservabilitySource
  = | 'chat-engine'
    | 'domain-event-bus'
    | 'ipc'
    | 'provider'
    | 'renderer'
    | 'http'
    | 'desktop-main'
    | 'server'

export interface RuntimeLogger {
  debug: (message: string, fields?: Record<string, unknown>) => void
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
}

export interface RuntimeObservabilityEventInput {
  source: RuntimeObservabilitySource
  code: string
  severity: RuntimeObservabilitySeverity
  category: RuntimeObservabilityCategory
  message: string
  attrs?: Record<string, unknown>
  chatSessionId?: string
  runId?: string
  messageId?: string
  traceId?: string
  dedupeKey?: string
  parentEventId?: string
  occurredAt?: number
  recordedAt?: number
}

export interface SecretValueWithMetadata {
  id: string
  kind: string
  label: string
  secret: string
}

export interface RuntimeLiveResourceLease<Resource = unknown> {
  readonly hostId?: string
  readonly pinned?: boolean
  readonly resource: Resource
  refresh: (ttlMs?: number) => void
  release: () => void
}

export interface CradleTurnTranscript {
  history: UIMessage[]
  omittedMessageCount: number
  truncated: boolean
  fallbackMessageCount: number
}

export interface RuntimeProviderTargetProfile {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  customModels: string
  iconSlug: string | null
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
}

export interface RuntimeOwnedProviderTarget {
  id: string
  kind: 'external'
  displayName: string
  providerKind: ProviderKind
  enabled: boolean
  iconSlug: string | null
  connectionConfigJson: string
  credentialRef: string | null
  enabledModelsJson: string
  customModelsJson: string
  sourceKey: string
  externalRecordId: string | null
  sourceFingerprint: string
  createdAt: number
  updatedAt: number
}

export interface ProjectRuntimeOwnedProviderTargetInput {
  providerTargetId: string
  now: number
}

export interface ListRuntimeOwnedProviderTargetsInput {
  runtimeKind: RuntimeKind
  workspacePath?: string
  now: number
}

export interface ListRuntimeOwnedProviderTargetModelsInput {
  runtimeKind: RuntimeKind
  providerTargetId: string
  workspacePath?: string
}

export interface RuntimeOwnedProviderTargets {
  ownsProviderTargetId: (providerTargetId: string) => boolean
  projectProviderTarget: (input: ProjectRuntimeOwnedProviderTargetInput) => RuntimeOwnedProviderTarget | null
  listProviderTargets?: (input: ListRuntimeOwnedProviderTargetsInput) => Promise<RuntimeOwnedProviderTarget[]>
  listModelsForProviderTarget?: (input: ListRuntimeOwnedProviderTargetModelsInput) => Promise<RuntimeModelDescriptor[]>
}

export type ChatThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface RuntimeSlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
}

export const RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID = 'cradle.runtime.codeReview'
export const RUNTIME_USAGE_COMMAND_ACTION_ID = 'cradle.runtime.usage'

/**
 * Cradle-owned canonical tool-call vocabulary. Every chat-runtime provider must
 * classify its own native tool calls into one of these kinds before the call
 * reaches persistence or the frontend — providers own the mapping, Cradle owns
 * the vocabulary. See `chat-runtime-providers/tools/README.md`.
 */
export const cradleToolKinds = [
  'file-read',
  'file-diff',
  'notebook-diff',
  'terminal',
  'search',
  'web',
  'subagent',
  'task-control',
  'todo',
  'plan',
  'plan-implementation',
  'question',
  'mcp',
  'worktree',
  'generic',
] as const
export type CradleToolKind = (typeof cradleToolKinds)[number]

export type RuntimeUiSlotSurface
  = | 'slashCommand'
    | 'toolbarPicker'
    | 'composerState'
    | 'messageInline'
    | 'runtimePanel'
  // Stream evidence is rendered from provider-emitted message/tool chunks, not from polled slot state.
    | 'streamEvidence'
    | 'recordOnly'

export type RuntimeUiSlotIconKey
  = | 'alert'
    | 'approvals'
    | 'code-review'
    | 'compact'
    | 'config'
    | 'diff'
    | 'feedback'
    | 'filesystem'
    | 'goal'
    | 'crew'
    | 'ide-context'
    | 'mcp'
    | 'model'
    | 'personality'
    | 'plugin'
    | 'plan'
    | 'progress'
    | 'quick-question'
    | 'user-input'
    | 'reasoning'
    | 'search'
    | 'side-chat'
    | 'skills'
    | 'status'
    | 'terminal'
    | 'tool-activity'
    | 'usage'

export type RuntimeUiSlotCommandAction
  = | { kind: 'insertText' }
    | { kind: 'submitText', requiresEmptyComposer?: boolean }
    | { kind: 'uiAction', actionId: string }

export interface RuntimeUiSlot {
  id: string
  name: string
  label: string
  description: string
  argumentHint: string
  aliases?: string[]
  iconKey?: RuntimeUiSlotIconKey
  commandText?: string
  commandAction?: RuntimeUiSlotCommandAction
  requiresSession?: boolean
  surfaces: RuntimeUiSlotSurface[]
}

export type RuntimeUiSlotStateKind
  = | 'alert'
    | 'approvals'
    | 'compact'
    | 'config'
    | 'crew'
    | 'diff'
    | 'filesystem'
    | 'goal'
    | 'mcp'
    | 'model'
    | 'plan'
    | 'progress'
    | 'plugin'
    | 'reasoning'
    | 'search'
    | 'skills'
    | 'status'
    | 'terminal'
    | 'toolActivity'
    | 'usage'
    | 'userInput'

export type RuntimeGoalStatus
  = | 'active'
    | 'paused'
    | 'blocked'
    | 'usageLimited'
    | 'budgetLimited'
    | 'complete'
export type RuntimeCompactStatus = 'idle' | 'running' | 'nearLimit' | 'overLimit' | 'compacted'
export type RuntimeThreadStatus = 'notLoaded' | 'idle' | 'systemError' | 'active'
export type RuntimePlanStepStatus = 'pending' | 'inProgress' | 'completed'
export type RuntimeToolActivityStatus = 'running' | 'completed' | 'failed'
export type RuntimeMcpServerStatus = 'starting' | 'ready' | 'failed' | 'cancelled' | 'unknown'
export type RuntimeMcpAuthStatus
  = | 'unsupported'
    | 'notLoggedIn'
    | 'bearerToken'
    | 'oAuth'
    | 'unknown'
export type RuntimeApprovalStatus = 'pending' | 'approved' | 'denied' | 'timedOut' | 'aborted'
export type RuntimeAlertSeverity = 'info' | 'warning' | 'error'

export interface RuntimeWarningPartData {
  message: string
  additionalDetails: string | null
}

export interface RuntimeTokenUsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export interface RuntimeContextUsageItem {
  kind: string
  label: string
  tokenCount: number
  metadata?: Record<string, unknown>
  raw?: unknown
}

export interface RuntimeContextUsageSection {
  kind: string
  label: string
  tokenCount: number
  color: string | null
  isDeferred: boolean
  items: RuntimeContextUsageItem[]
  raw?: unknown
}

export interface RuntimeContextUsage {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  source: string
  model: string | null
  totalTokens: number
  maxTokens: number | null
  rawMaxTokens: number | null
  percentage: number | null
  sections: RuntimeContextUsageSection[]
  messageBreakdown: Record<string, unknown> | null
  apiUsage: Record<string, unknown> | null
  raw: unknown
  updatedAt: number
}

export interface RuntimeGoalUiSlotState {
  kind: 'goal'
  slotId: string
  threadId: string
  objective: string
  status: RuntimeGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export interface RuntimeCompactUiSlotState {
  kind: 'compact'
  slotId: string
  threadId: string
  turnId: string | null
  status: RuntimeCompactStatus
  isCompactRelevant: boolean
  total: RuntimeTokenUsageBreakdown
  last: RuntimeTokenUsageBreakdown
  modelContextWindow: number | null
  autoCompactTokenLimit: number | null
  usagePercent: number | null
  autoCompactPercent: number | null
  lastCompactedAt: number | null
  compactionItemId: string | null
  updatedAt: number
}

export interface RuntimeStatusUiSlotState {
  kind: 'status'
  slotId: string
  threadId: string
  status: RuntimeThreadStatus
  activeFlags: string[]
  updatedAt: number
}

export interface RuntimeModelUiSlotState {
  kind: 'model'
  slotId: string
  threadId: string
  modelId: string | null
  modelLabel: string | null
  modelProvider: string | null
  serviceTier: string | null
  supportsImages: boolean | null
  supportsWebSearch: boolean | null
  supportsNamespaceTools: boolean | null
  updatedAt: number
}

export interface RuntimeReasoningUiSlotState {
  kind: 'reasoning'
  slotId: string
  threadId: string
  effort: string | null
  summary: string | null
  supportedEfforts: Array<{ id: string, description: string }>
  updatedAt: number
}

export interface RuntimePlanStep {
  step: string
  status: RuntimePlanStepStatus
}

export interface RuntimePlanUiSlotState {
  kind: 'plan'
  slotId: string
  threadId: string
  turnId: string | null
  explanation: string | null
  content: string | null
  steps: RuntimePlanStep[]
  currentStep: string | null
  pendingCount: number
  inProgressCount: number
  completedCount: number
  updatedAt: number
}

export interface RuntimeProgressItem {
  id: string | null
  label: string
  status: RuntimePlanStepStatus
  sourceStatus: string | null
}

export interface RuntimeProgressUiSlotState {
  kind: 'progress'
  slotId: string
  threadId: string
  turnId: string | null
  source: string
  items: RuntimeProgressItem[]
  currentItem: string | null
  pendingCount: number
  inProgressCount: number
  completedCount: number
  updatedAt: number
}

export interface RuntimeToolActivityItem {
  id: string
  type: string
  label: string
  status: RuntimeToolActivityStatus
  startedAt: number | null
  completedAt: number | null
}

export interface RuntimeToolActivityUiSlotState {
  kind: 'toolActivity'
  slotId: string
  threadId: string
  turnId: string | null
  activeCount: number
  completedCount: number
  failedCount: number
  recentItems: RuntimeToolActivityItem[]
  updatedAt: number
}

export interface RuntimeCrewCollaborationMode {
  name: string
  mode: string | null
  model: string | null
  reasoningEffort: string | null
}

export interface RuntimeCrewAgentItem {
  threadId: string
  status: string | null
  message: string | null
  name: string | null
  preview: string | null
  modelProvider: string | null
  agentNickname: string | null
  agentRole: string | null
}

export interface RuntimeCrewCallItem {
  id: string
  tool: string
  status: RuntimeToolActivityStatus
  senderThreadId: string | null
  receiverThreadIds: string[]
  prompt: string | null
  model: string | null
  reasoningEffort: string | null
  agents: RuntimeCrewAgentItem[]
  startedAt: number | null
  completedAt: number | null
}

export interface RuntimeMcpServerSummary {
  name: string
  status: RuntimeMcpServerStatus
  authStatus: RuntimeMcpAuthStatus
  toolCount: number
  resourceCount: number
  error: string | null
}

export interface RuntimeMcpUiSlotState {
  kind: 'mcp'
  slotId: string
  threadId: string
  serverCount: number
  readyCount: number
  failedCount: number
  needsLoginCount: number
  recentProgress: string | null
  servers: RuntimeMcpServerSummary[]
  updatedAt: number
}

export interface RuntimeDiffUiSlotState {
  kind: 'diff'
  slotId: string
  threadId: string
  turnId: string | null
  fileCount: number
  addedLines: number
  removedLines: number
  hasDiff: boolean
  updatedAt: number
}

export interface RuntimeBackgroundTerminal {
  itemId: string
  processId: string
  command: string
  cwd: string
  osPid: number | null
  cpuPercent: number | null
  rssKb: number | null
}

export interface RuntimeTerminalUiSlotState {
  kind: 'terminal'
  slotId: string
  threadId: string
  turnId: string | null
  activeCount: number
  completedCount: number
  failedCount: number
  lastCommand: string | null
  lastOutputPreview: string | null
  backgroundTerminals: RuntimeBackgroundTerminal[]
  updatedAt: number
}

export interface RuntimeApprovalItem {
  id: string
  targetItemId: string | null
  status: RuntimeApprovalStatus
  label: string
  riskLevel: string | null
  rationale: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface RuntimeApprovalsUiSlotState {
  kind: 'approvals'
  slotId: string
  threadId: string
  turnId: string | null
  pendingCount: number
  approvedCount: number
  deniedCount: number
  recentItems: RuntimeApprovalItem[]
  updatedAt: number
}

export interface RuntimeAlertItem {
  id: string
  severity: RuntimeAlertSeverity
  message: string
  source: string
  updatedAt: number
}

export interface RuntimeAlertUiSlotState {
  kind: 'alert'
  slotId: string
  threadId: string | null
  warningCount: number
  errorCount: number
  recentItems: RuntimeAlertItem[]
  updatedAt: number
}

export interface RuntimeFilesystemUiSlotState {
  kind: 'filesystem'
  slotId: string
  threadId: string
  changedPathCount: number
  recentPaths: string[]
  updatedAt: number
}

export interface RuntimeSkillsUiSlotState {
  kind: 'skills'
  slotId: string
  threadId: string
  enabledCount: number
  disabledCount: number
  errorCount: number
  roots: string[]
  updatedAt: number
}

export interface RuntimePluginUiSlotState {
  kind: 'plugin'
  slotId: string
  threadId: string
  installedCount: number
  enabledCount: number
  appCount: number
  marketplaceCount: number
  errorCount: number
  updatedAt: number
}

export interface RuntimeSearchUiSlotState {
  kind: 'search'
  slotId: string
  threadId: string
  recentResultCount: number
  recentQuery: string | null
  fuzzySessionActive: boolean
  updatedAt: number
}

export interface RuntimeCrewUiSlotState {
  kind: 'crew'
  slotId: string
  threadId: string
  activeCount: number
  completedCount: number
  failedCount: number
  recentItems: RuntimeToolActivityItem[]
  agents: RuntimeCrewAgentItem[]
  collaborationModeCount: number
  collaborationModes: RuntimeCrewCollaborationMode[]
  calls: RuntimeCrewCallItem[]
  updatedAt: number
}

export interface RuntimeUsageUiSlotState {
  kind: 'usage'
  slotId: string
  threadId: string
  limitName: string | null
  usedPercent: number | null
  primaryWindowDurationMins: number | null
  primaryResetsAt: number | null
  secondaryUsedPercent: number | null
  secondaryWindowDurationMins: number | null
  secondaryResetsAt: number | null
  creditsBalance: string | null
  hasCredits: boolean | null
  rateLimitReachedType: string | null
  planType: string | null
  updatedAt: number
}

export interface RuntimeConfigUiSlotState {
  kind: 'config'
  slotId: string
  threadId: string
  modelId: string | null
  approvalPolicy: string | null
  sandboxMode: string | null
  allowedApprovalPolicyCount: number | null
  allowedSandboxModeCount: number | null
  featureRequirementCount: number | null
  webSearchModeCount: number | null
  updatedAt: number
}

export interface RuntimeUserInputUiSlotState {
  kind: 'userInput'
  slotId: string
  threadId: string | null
  runId: string
  requestId: string
  providerMethod: string
  toolCallId: string
  questionCount: number
  questions: RuntimeUserInputQuestion[]
  createdAt: number
  updatedAt: number
}

export type RuntimeUiSlotState
  = | RuntimeAlertUiSlotState
    | RuntimeApprovalsUiSlotState
    | RuntimeCompactUiSlotState
    | RuntimeConfigUiSlotState
    | RuntimeCrewUiSlotState
    | RuntimeDiffUiSlotState
    | RuntimeFilesystemUiSlotState
    | RuntimeGoalUiSlotState
    | RuntimeMcpUiSlotState
    | RuntimeModelUiSlotState
    | RuntimePlanUiSlotState
    | RuntimeProgressUiSlotState
    | RuntimePluginUiSlotState
    | RuntimeReasoningUiSlotState
    | RuntimeSearchUiSlotState
    | RuntimeSkillsUiSlotState
    | RuntimeStatusUiSlotState
    | RuntimeTerminalUiSlotState
    | RuntimeToolActivityUiSlotState
    | RuntimeUsageUiSlotState
    | RuntimeUserInputUiSlotState

export interface RuntimePresentationCapabilities {
  runtimeKind: RuntimeKind
  slashCommands: RuntimeSlashCommand[]
  uiSlots: RuntimeUiSlot[]
  skills: string[]
}

export function createEmptyRuntimePresentation(
  runtimeKind: RuntimeKind,
): RuntimePresentationCapabilities {
  return {
    runtimeKind,
    slashCommands: [],
    uiSlots: [],
    skills: [],
  }
}

/**
 * `'native'`: the runtime implements `steerTurn` and can redirect an in-flight run.
 * `'queue-fallback'`: the runtime has no native steer; steer requests are transparently
 * enqueued instead (queueing is generic/session-level and available to every runtime).
 * `'unsupported'`: neither native steer nor queue fallback is available for this runtime.
 */
export type ChatRuntimeSteerCapability = 'native' | 'queue-fallback' | 'unsupported'

export interface ChatRuntimeCapabilities {
  readonly steer: ChatRuntimeSteerCapability
  readonly supportsShellExecution: boolean
  readonly supportsLastTurnRollback: boolean
  readonly supportsRuntimeSettings: boolean
  readonly supportsUiSlotStates: boolean
  readonly supportsDynamicCapabilities: boolean
  readonly supportsTitleGeneration: boolean
  readonly sessionModelSwitch: 'in-session' | 'restart-session' | 'unsupported'
}

export type ChatRuntimeStability = 'stable' | 'experimental'

export type ChatRuntimeCapabilityDegradationStatus = 'unsupported' | 'partial' | 'experimental'

export interface ChatRuntimeCapabilityDegradation {
  capability: string
  status: ChatRuntimeCapabilityDegradationStatus
  reason: string
}

export interface ProviderHealthStatus {
  status: 'healthy' | 'unhealthy' | 'unknown'
  message?: string
  latencyMs?: number
  lastCheckedAt: number
}

export interface ChatRuntimeHealthItem extends ProviderHealthStatus {
  runtimeKind: RuntimeKind
  source: 'builtin' | 'plugin'
  pluginOwner: string | null
  hasHealthCheck: boolean
}

export type ChatSessionTailEventType
  = | 'UserMessageAppended'
    | 'MessageImported'
    | 'RunStarted'
    | 'AssistantMessageCompleted'
    | 'RunCompleted'
    | 'RunFailed'
    | 'RunAborted'
    | 'InteractionRequested'
    | 'InteractionResolved'
    | 'PlanImplementationResponded'
    | 'QueueItemEnqueued'
    | 'QueueItemClaimed'
    | 'QueueItemReleased'
    | 'QueueItemFailed'
    | 'QueueItemReordered'
    | 'QueueItemUpdated'
    | 'QueueItemProviderTargetCleared'
    | 'QueueItemCancelled'
    | 'SteerApplied'
    | 'LastTurnRolledBack'
    | 'TitleChanged'
    | 'SnapshotRequired'

export type ChatSessionTailEventPayload
  = | { messageId: string }
    | {
      runId: string
      assistantMessageId: string | null
      queueItemId: string | null
      runtimeSettings?: RuntimeSettings
    }
    | { messageId: string, status: 'streaming' | 'complete' | 'aborted' | 'failed' }
    | {
      runId: string
      queueItemId: string | null
      bindingId: string | null
      status: 'complete' | 'aborted' | 'failed'
      stopReason: string
      errorText: string | null
    }
    | {
      runId: string
      requestId: string
      interactionKind: 'toolApproval' | 'userInput'
      providerMethod: string
      toolCallId: string
      questionCount: number | null
    }
    | {
      runId: string
      requestId: string
      interactionKind: 'toolApproval' | 'userInput'
      resolution: 'submitted' | 'cancelled'
      approved: boolean | null
    }
    | { messageId: string, approvalId: string, approved: boolean }
    | {
      reason: 'tail_gap'
      latestVersion: number
      latestSequenceId: number
    }
    | { queueItemId: string, status?: string, startedRunId?: string | null }
    | { queueItemId: string, position: number }
    | { queueItemId: string, updatedAt: number }
    | {
      messageIds: string[]
      providerRuntimeKind: string
      providerSessionId: string | null
      providerRolledBackTurns: number
    }
    | { title: string, titleSource: 'provider' | 'user' }

export interface ChatSessionTailEvent {
  scope: 'session'
  sessionId: string
  sequenceId: number
  version: number
  type: ChatSessionTailEventType
  occurredAt: number
  payload: ChatSessionTailEventPayload
}

export interface ChatGlobalSessionTailEvent {
  scope: 'sessions'
  sessionId: string
  sequenceId: number
  version: number
  type: ChatSessionTailEventType
  occurredAt: number
  payload: ChatSessionTailEventPayload
}

export interface ProviderContext {
  readSecret: (credentialRef: string) => string
  readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
  updateSecret?: (credentialRef: string, value: string) => void
  resolveSkillPaths?: (workspacePath: string) => string[]
  updateSessionRuntimeSettings?: (input: {
    sessionId: string
    patch: RuntimeSettingsPatch
  }) => Promise<void>
  requestUserInput?: (input: RuntimeUserInputRequest) => Promise<RuntimeUserInputResolution>
  requestToolApproval?: (input: RuntimeToolApprovalRequest) => Promise<RuntimeToolApprovalResolution>
  recordObservability?: (input: RuntimeObservabilityEventInput) => void
  logger?: RuntimeLogger
}

export interface RuntimeUserInputOption {
  label: string
  description: string
}

export interface RuntimeUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  multiSelect: boolean
  options: RuntimeUserInputOption[] | null
}

export interface RuntimeUserInputRequest {
  sessionId: string
  runId: string
  providerRequestId: string
  providerKind: ProviderKind
  runtimeKind: RuntimeKind
  providerMethod: string
  toolCallId: string
  questions: RuntimeUserInputQuestion[]
  metadata?: Record<string, unknown>
}

export interface RuntimeUserInputResolution {
  requestId: string
  answers: Record<string, string[]>
}

export interface SubmitRuntimeUserInputInput extends GetCapabilitiesInput {
  requestId: string
  answers: Record<string, string[]>
}

export interface RuntimeToolApprovalRequest {
  sessionId: string
  runId: string
  providerRequestId: string
  providerKind: ProviderKind
  runtimeKind: RuntimeKind
  providerMethod: string
  toolCallId: string
  metadata?: Record<string, unknown>
}

export interface RuntimeToolApprovalResolution {
  requestId: string
  approved: boolean
  reason?: string
}

export type ProviderError
  = | { _tag: 'provider_unsupported', provider: string }
    | { _tag: 'session_not_found', provider: string, sessionId: string }
    | { _tag: 'session_closed', provider: string, sessionId: string }
    | { _tag: 'request_failed', provider: string, method: string, detail: string }
    | { _tag: 'process_error', provider: string, detail: string }
    | { _tag: 'auth_failed', provider: string }
    | { _tag: 'rate_limited', provider: string, retryAfter?: number }
    | { _tag: 'model_not_found', provider: string, model: string }

export class ProviderRuntimeError extends Error {
  constructor(
    readonly providerError: ProviderError,
    options?: { cause?: unknown },
  ) {
    super(formatProviderErrorMessage(providerError), options)
    this.name = 'ProviderRuntimeError'
  }
}

function formatProviderErrorMessage(error: ProviderError): string {
  switch (error._tag) {
    case 'provider_unsupported':
      return `Provider is unsupported: ${error.provider}`
    case 'session_not_found':
      return `Provider session was not found: ${error.provider}/${error.sessionId}`
    case 'session_closed':
      return `Provider session is closed: ${error.provider}/${error.sessionId}`
    case 'request_failed':
      return error.detail
    case 'process_error':
      return error.detail
    case 'auth_failed':
      return `${error.provider} authentication failed`
    case 'rate_limited':
      return error.retryAfter === undefined
        ? `${error.provider} is rate limited`
        : `${error.provider} is rate limited; retry after ${error.retryAfter}s`
    case 'model_not_found':
      return error.model
        ? `${error.provider} model was not found: ${error.model}`
        : `${error.provider} model was not configured`
  }
}

export const ProviderErrors = {
  providerUnsupported: (provider: string): ProviderError => ({
    _tag: 'provider_unsupported',
    provider,
  }),
  sessionNotFound: (provider: string, sessionId: string): ProviderError => ({
    _tag: 'session_not_found',
    provider,
    sessionId,
  }),
  sessionClosed: (provider: string, sessionId: string): ProviderError => ({
    _tag: 'session_closed',
    provider,
    sessionId,
  }),
  requestFailed: (provider: string, method: string, detail: string): ProviderError => ({
    _tag: 'request_failed',
    provider,
    method,
    detail,
  }),
  processError: (provider: string, detail: string): ProviderError => ({
    _tag: 'process_error',
    provider,
    detail,
  }),
  authFailed: (provider: string): ProviderError => ({
    _tag: 'auth_failed',
    provider,
  }),
  rateLimited: (provider: string, retryAfter?: number): ProviderError => ({
    _tag: 'rate_limited',
    provider,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  }),
  modelNotFound: (provider: string, model: string): ProviderError => ({
    _tag: 'model_not_found',
    provider,
    model,
  }),
} as const

export function requireRuntimeProviderTargetProfile(
  profile: RuntimeProviderTargetProfile | null,
  runtimeKind: RuntimeKind,
): RuntimeProviderTargetProfile {
  if (!profile) {
    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        runtimeKind,
        'provider-binding',
        `Runtime requires a provider target profile: ${runtimeKind}`,
      ),
    )
  }
  return profile
}

export type RuntimeCatalogSurface = 'chat' | 'jarvis'
export type RuntimeIconDescriptor = { key: string } | { svg: string } | { url: string }
export type ChatRuntimeAvailability = 'stable' | 'preview' | 'dev-only' | 'hidden'
export type RuntimeSessionLaunchMode = 'runtime-provider' | 'agent-terminal'
export type RuntimeComposerInputMode = 'rich' | 'collapsed' | 'none'
export type RuntimeComposerModelSelection = 'provider-model' | 'runtime-owned' | 'alias-matrix' | 'none'
export type RuntimeComposerThinkingDescriptor
  = | { efforts: string[] }
    | 'per-model'
    | 'unsupported'

export interface RuntimeComposerDescriptor {
  inputMode: RuntimeComposerInputMode
  allowEmptySubmit?: boolean
  modelSelection: RuntimeComposerModelSelection
  thinking: RuntimeComposerThinkingDescriptor
}

export type RuntimeSettingsSchemaLike = Record<string, unknown>

export interface ChatRuntimeMetadata {
  label: string
  description?: string
  providerKinds: ProviderKind[]
  providerBinding?: 'required' | 'runtime-owned'
  sessionLaunchMode?: RuntimeSessionLaunchMode
  icon?: RuntimeIconDescriptor
  iconKey?: string
  surfaces?: RuntimeCatalogSurface[]
  sortOrder?: number
  stability?: ChatRuntimeStability
  availability?: ChatRuntimeAvailability
  degradations?: ChatRuntimeCapabilityDegradation[]
  composer?: RuntimeComposerDescriptor
  slots?: RuntimeUiSlot[]
  settingsSchema?: RuntimeSettingsSchemaLike
}

export interface ChatRuntimeCatalogItem extends ChatRuntimeMetadata {
  runtimeKind: RuntimeKind
  source: 'builtin' | 'plugin'
  pluginOwner: string | null
  icon: RuntimeIconDescriptor
  availability: ChatRuntimeAvailability
  sessionLaunchMode: RuntimeSessionLaunchMode
  composer: RuntimeComposerDescriptor
  slots: RuntimeUiSlot[]
  capabilities: ChatRuntimeCapabilities | null
}

export type RuntimeSettingsValue = string | number | boolean

/** Provider-native session runtime settings persisted in `config_json.runtimeSettings`. */
export type RuntimeSettings = Record<string, RuntimeSettingsValue>

export type RuntimeSettingsPatch = Partial<RuntimeSettings>

export interface RuntimeSession {
  id: string
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  providerStateSnapshot: string | null
  providerRuntimeLease?: RuntimeLiveResourceLease<unknown>
}

export interface StartChatSessionInput {
  chatSessionId: string
  profile: RuntimeProviderTargetProfile | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
  previousProviderStateSnapshot?: string | null
}

export interface ResumeChatSessionInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
}

export interface ForkRuntimeSessionInput {
  sourceRuntimeSession: RuntimeSession
  childChatSessionId: string
  profile: RuntimeProviderTargetProfile | null
  workspaceId?: string | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
  systemPrompt?: string
}

export interface QuickQuestionInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  question: string
  transcript: UIMessage[]
  workspaceId?: string | null
  workspacePath: string
}

export interface StreamTurnInput {
  runId: string
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  message: UIMessage
  transcript?: CradleTurnTranscript
  originalMessages?: UIMessage[]
  responseMessageId?: string
  /** When set, the turn was drained from a Cradle queue item (may already be native-enqueued). */
  queueItemId?: string | null
  modelId?: string | null
  workspaceId?: string | null
  workspacePath?: string
  agentId?: string | null
  providerOptions?: {
    thinkingEffort?: ChatThinkingEffort
    runtimeSettings?: RuntimeSettings
  }
  systemPrompt?: string
  history?: UIMessage[]
  reportSessionTitle?: (title: string) => void
  onProviderThreadEvent?: (event: ProviderThreadEvent) => void
  onProviderSyntheticTurnEvent?: (event: ProviderSyntheticTurnEvent) => void | Promise<void>
}

export interface ProviderSyntheticTurnEvent {
  providerTurnId: string
  providerThreadId?: string | null
  chunks: UIMessageChunk[]
}

export type ProviderThreadSourceKind
  = | 'cli'
    | 'vscode'
    | 'exec'
    | 'appServer'
    | 'subAgent'
    | 'subAgentReview'
    | 'subAgentCompact'
    | 'subAgentThreadSpawn'
    | 'subAgentOther'
    | 'unknown'

export interface ProviderThreadListInput extends GetCapabilitiesInput {
  cursor?: string | null
  limit?: number | null
  sortKey?: 'created_at' | 'updated_at' | null
  sortDirection?: 'asc' | 'desc' | null
  sourceKinds?: ProviderThreadSourceKind[] | null
  archived?: boolean | null
  searchTerm?: string | null
}

export interface ProviderThreadReadInput extends GetCapabilitiesInput {
  threadId: string
  includeTurns?: boolean
}

export interface ProviderThreadDeleteInput extends GetCapabilitiesInput {
  threadId: string
}

export interface ProviderThreadTurnsInput extends GetCapabilitiesInput {
  threadId: string
  cursor?: string | null
  limit?: number | null
  sortDirection?: 'asc' | 'desc' | null
}

export interface ListBackgroundTerminalsInput extends GetCapabilitiesInput {
  cursor?: string | null
  limit?: number | null
}

export interface TerminateBackgroundTerminalInput extends GetCapabilitiesInput {
  processId: string
}

export interface ProviderThreadListResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  threads: ProviderThread[]
  nextCursor: string | null
  backwardsCursor: string | null
}

export interface ProviderThreadReadResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  thread: ProviderThread
}

export interface ProviderThreadDeleteResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  threadId: string
  deleted: true
}

export interface ProviderThreadTurnsResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  threadId: string
  turns: ProviderThreadTurn[]
  messages: UIMessage[]
  nextCursor: string | null
  backwardsCursor: string | null
}

export interface BackgroundTerminalListResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  terminals: RuntimeBackgroundTerminal[]
  nextCursor: string | null
}

export interface BackgroundTerminalTerminateResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  processId: string
  terminated: boolean
}

export interface ProviderThread {
  id: string
  providerSessionTreeId: string | null
  forkedFromId: string | null
  preview: string | null
  ephemeral: boolean
  modelProvider: string | null
  createdAt: number | null
  updatedAt: number | null
  status: string
  sourceKind: ProviderThreadSourceKind
  source: unknown
  threadSource: unknown
  agentNickname: string | null
  agentRole: string | null
  name: string | null
  cwd: string | null
}

export interface ProviderThreadTurn {
  id: string
  status: string
  startedAt: number | null
  completedAt: number | null
  durationMs: number | null
  itemsView: string
  items: unknown[]
}

export interface ProviderThreadEvent {
  providerThreadId: string
  providerTurnId: string | null
  notification: unknown
  chunks: UIMessageChunk[]
}

export interface CancelTurnInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
}

export interface RollbackLastTurnInput extends GetCapabilitiesInput {}

export interface RollbackLastTurnResult {
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  rolledBackTurns: number
  fileChangesReverted: false
  providerResult?: unknown
}

export interface SteerTurnInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  message: UIMessage
}

export interface ExecuteShellCommandInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  workspaceId?: string | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
  command: string
  signal?: AbortSignal
}

export interface ExecuteShellCommandResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

export interface GetCapabilitiesInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  workspaceId?: string | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
  systemPrompt?: string
}

export interface GetUiSlotStatesInput extends GetCapabilitiesInput {}
export interface GetContextUsageInput extends GetCapabilitiesInput {}

export interface GenerateSessionTitleInput extends GetCapabilitiesInput {
  promptText: string
}

export interface UpdateRuntimeSettingsInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile | null
  settings: RuntimeSettings
}

export interface RuntimeGoalContinuationOptions {
  includeBlockedGoals?: boolean
}

export interface RuntimeContinuableGoal {
  objective: string
  status: string
}

export interface ReadRuntimeContinuableGoalInput {
  providerStateSnapshot: string | null | undefined
  options?: RuntimeGoalContinuationOptions
}

export interface ReadRuntimeGoalCommandObjectiveInput {
  text: string
}

export interface RuntimeGoalContinuationMessageInput {
  message: UIMessage
}

export interface RuntimeGoalContinuation {
  continuationPrompt: string
  readContinuableGoal: (input: ReadRuntimeContinuableGoalInput) => RuntimeContinuableGoal | null
  readGoalCommandObjective?: (input: ReadRuntimeGoalCommandObjectiveInput) => string | null
  annotateContinuationMessage: (input: RuntimeGoalContinuationMessageInput) => UIMessage
  isContinuationMessage: (input: RuntimeGoalContinuationMessageInput) => boolean
  allowsEmptyResponse: (input: RuntimeGoalContinuationMessageInput) => boolean
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  reasoningOutputTokens?: number
}

export interface RuntimeStepUsage {
  stepNumber: number
  stepType: string
  modelId?: string
  usage: TokenUsage
}

export interface ChatRuntime {
  readonly runtimeKind: RuntimeKind
  readonly metadata: ChatRuntimeMetadata
  readonly capabilities: ChatRuntimeCapabilities
  readonly ownedProviderTargets?: RuntimeOwnedProviderTargets
  readonly lastUsage?: TokenUsage | null
  readonly totalUsage?: TokenUsage | null
  readonly lastModelId?: string | null
  /** Per-step usage recorded during the most recently streamed turn, if the runtime tracks it. */
  readonly lastStepUsages?: RuntimeStepUsage[]
  readonly goalContinuation?: RuntimeGoalContinuation
  startChatSession: (input: StartChatSessionInput) => Promise<RuntimeSession>
  resumeChatSession: (input: ResumeChatSessionInput) => Promise<RuntimeSession>
  forkRuntimeSession?: (input: ForkRuntimeSessionInput) => Promise<RuntimeSession>
  quickQuestion?: (input: QuickQuestionInput) => AsyncGenerator<UIMessageChunk, void, void>
  getDraftPresentation?: () =>
    | Promise<RuntimePresentationCapabilities>
    | RuntimePresentationCapabilities
  getPresentation?: (input: GetCapabilitiesInput) => Promise<RuntimePresentationCapabilities>
  getDynamicCapabilities?: (input: GetCapabilitiesInput) => Promise<ChatRuntimeCapabilities>
  getUiSlotStates?: (input: GetUiSlotStatesInput) => Promise<RuntimeUiSlotState[]>
  getContextUsage?: (input: GetContextUsageInput) => Promise<RuntimeContextUsage | null>
  submitUserInput?: (input: SubmitRuntimeUserInputInput) => Promise<RuntimeUserInputResolution | null>
  listProviderThreads?: (input: ProviderThreadListInput) => Promise<ProviderThreadListResult>
  readProviderThread?: (input: ProviderThreadReadInput) => Promise<ProviderThreadReadResult>
  deleteProviderThread?: (input: ProviderThreadDeleteInput) => Promise<ProviderThreadDeleteResult>
  listProviderThreadTurns?: (input: ProviderThreadTurnsInput) => Promise<ProviderThreadTurnsResult>
  listBackgroundTerminals?: (
    input: ListBackgroundTerminalsInput,
  ) => Promise<BackgroundTerminalListResult>
  terminateBackgroundTerminal?: (
    input: TerminateBackgroundTerminalInput,
  ) => Promise<BackgroundTerminalTerminateResult>
  generateSessionTitle?: (input: GenerateSessionTitleInput) => Promise<string | null>
  /**
   * Stream a turn, yielding AI SDK UIMessageChunk events directly.
   * No custom intermediate abstraction — pure AI SDK protocol.
   */
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<UIMessageChunk, void, void>
  steerTurn?: (input: SteerTurnInput) => Promise<void>
  executeShellCommand?: (input: ExecuteShellCommandInput) => Promise<ExecuteShellCommandResult>
  rollbackLastTurn?: (input: RollbackLastTurnInput) => Promise<RollbackLastTurnResult>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
  listModels?: (input: ListRuntimeModelsInput) => Promise<RuntimeModelCatalog>
  updateRuntimeSettings?: (input: UpdateRuntimeSettingsInput) => Promise<void>
  healthCheck?: () => Promise<ProviderHealthStatus>
  dispose?: () => Promise<void>
}

export * from './sync-protocol'
