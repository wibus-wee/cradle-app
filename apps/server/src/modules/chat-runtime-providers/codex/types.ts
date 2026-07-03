/**
 * Output: Codex provider-private types shared by package modules.
 * Input: provider context, app-server client options/messages, and active turn bookkeeping.
 * Position: Codex provider package type boundary.
 */

import type {
  ProviderContext,
  RuntimeAlertSeverity,
  RuntimeApprovalStatus,
  RuntimeCompactUiSlotState,
  RuntimeGoalStatus,
  RuntimeMcpAuthStatus,
  RuntimeMcpServerStatus,
  RuntimePlanStepStatus,
  RuntimeProviderTargetProfile,
  RuntimeToolActivityStatus,
} from '../../chat-runtime/runtime-provider-types'
import type { ProviderProcessHostLease } from '../kit/process-host'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './app-server/client'
import type { ReasoningEffort } from './app-server-protocol/ReasoningEffort'
import type { CodexNativeHistorySnapshot } from './projection/state-projector'

export interface CodexProviderConfig {
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  readCodexPreferences?: () => { useCradleUserAgent: boolean }
  readChatPreferences?: () => {
    titleGeneration: {
      providerTargetId: string | null
      modelId: string | null
      thinkingEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    }
  }
  resolveProviderTargetProfile?: (providerTargetId: string) => RuntimeProviderTargetProfile | null
}

export type CodexProviderDeps = ProviderContext & CodexProviderConfig

export interface CodexAppServerClientLike {
  initialize: () => Promise<void>
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: (signal?: AbortSignal) => Promise<CodexAppServerMessage | null>
  close: () => void
}

export interface CodexAppServerResourceRequestHandler {
  (request: CodexAppServerServerRequest): Promise<unknown> | unknown
  readThreadId?: () => string | null
}

export interface CodexAppServerNotificationSubscriber {
  onMessage: (message: CodexAppServerMessage) => boolean
  onClose: () => void
}

export interface CodexAppServerHostResource {
  client: CodexAppServerClientLike
  serverRequestHandlers: Set<CodexAppServerResourceRequestHandler>
  notificationSubscribers: Set<CodexAppServerNotificationSubscriber>
  notificationAbortController?: AbortController
  notificationPump?: Promise<void>
  initialized?: Promise<void>
  chatgptAuthenticated?: Promise<void>
}

export interface ActiveCodexTurn {
  client: CodexAppServerClientLike
  hostLease: ProviderProcessHostLease<CodexAppServerHostResource>
  abortController: AbortController
  threadId: string
  turnId: string | null
  modelId: string | null
  reasoningEffort: ReasoningEffort | null
}

export interface CodexThreadStatus {
  type?: string
  activeFlags?: string[]
}

export interface CodexThreadSettings {
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  effort?: string | null
  summary?: string | null
}

export interface CodexThreadMetadata {
  id: string
  name: string | null
  preview: string | null
  modelProvider: string | null
  agentNickname: string | null
  agentRole: string | null
}

export interface ThreadResponse {
  thread?: {
    id?: string
    name?: string | null
    title?: string | null
    preview?: string | null
    status?: CodexThreadStatus
    modelProvider?: string | null
    agentNickname?: string | null
    agentRole?: string | null
  }
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  reasoningEffort?: string | null
}

export interface TurnResponse {
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
  turnId?: string
}

export interface TurnNotificationParams {
  threadId?: string
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
}

export interface ThreadGoalGetResponse {
  goal?: {
    threadId?: string
    objective?: string
    status?: string
    tokenBudget?: number | null
    tokensUsed?: number
    timeUsedSeconds?: number
    createdAt?: number
    updatedAt?: number
  } | null
}

export interface CodexTokenUsageBreakdown {
  totalTokens?: number
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
}

export interface CodexThreadTokenUsage {
  total?: CodexTokenUsageBreakdown
  last?: CodexTokenUsageBreakdown
  modelContextWindow?: number | null
}

export interface ThreadTokenUsageUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  tokenUsage?: CodexThreadTokenUsage
}

export interface ContextCompactedNotificationParams {
  threadId?: string
  turnId?: string
}

export interface ItemNotificationParams {
  item?: CodexThreadItem
  threadId?: string
  turnId?: string
  startedAtMs?: number
  completedAtMs?: number
}

export interface TurnPlanUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  explanation?: string | null
  plan?: Array<{ step?: string, status?: string }>
}

export interface McpToolCallProgressNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  message?: string
}

export interface TurnDiffUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  diff?: string
}

export interface FileChangePatchUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  changes?: Array<{ path?: string, diff?: string }>
}

export interface CommandExecutionOutputDeltaNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  delta?: string
}

export interface ProcessOutputDeltaNotificationParams {
  processHandle?: string
  deltaBase64?: string
}

export interface ProcessExitedNotificationParams {
  processHandle?: string
  exitCode?: number
  stdout?: string
  stderr?: string
}

export interface TerminalInteractionNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  processId?: string
  stdin?: string
}

export interface GuardianApprovalReviewNotificationParams {
  threadId?: string
  turnId?: string
  startedAtMs?: number
  completedAtMs?: number
  reviewId?: string
  targetItemId?: string | null
  review?: {
    status?: string
    riskLevel?: string | null
    rationale?: string | null
  }
  action?: { type?: string } | string
}

export interface WarningNotificationParams {
  threadId?: string | null
  message?: string
  summary?: string
  details?: string | null
}

export interface ServerRequestResolvedNotificationParams {
  threadId?: string
  requestId?: string
}

export interface FsChangedNotificationParams {
  changedPaths?: string[]
}

export interface AccountRateLimitsUpdatedNotificationParams {
  rateLimits?: CodexRateLimitSnapshot
}

export interface FuzzyFileSearchSessionNotificationParams {
  threadId?: string
  query?: string
  resultCount?: number
  results?: unknown[]
}

export interface ErrorNotificationParams {
  message?: string
  willRetry?: boolean
  error?: {
    message?: string
    additionalDetails?: string | null
    codexErrorInfo?: unknown
  }
  code?: string
  details?: unknown
  threadId?: string | null
  turnId?: string | null
}

export interface ThreadNameUpdatedNotificationParams {
  threadId?: string
  threadName?: string
}

export interface ThreadStatusChangedNotificationParams {
  threadId?: string
  status?: CodexThreadStatus
}

export interface ThreadSettingsUpdatedNotificationParams {
  threadId?: string
  threadSettings?: CodexThreadSettings
}

export interface CodexConfigReadResponse {
  config?: {
    model?: string | null
    model_provider?: string | null
    model_context_window?: number | bigint | null
    model_auto_compact_token_limit?: number | bigint | null
    model_reasoning_effort?: string | null
    model_reasoning_summary?: string | null
    service_tier?: string | null
    approval_policy?: string | null
    sandbox_mode?: string | null
  } | null
}

export interface CodexConfigRequirementsReadResponse {
  requirements?: {
    allowedApprovalPolicies?: string[] | null
    allowedSandboxModes?: string[] | null
    allowedWebSearchModes?: string[] | null
    featureRequirements?: Record<string, boolean> | null
  } | null
}

export interface CodexRateLimitsResponse {
  rateLimits?: CodexRateLimitSnapshot | null
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot | undefined> | null
}

export interface CodexRateLimitSnapshot {
  limitId?: string | null
  limitName?: string | null
  primary?: { usedPercent?: number | null, windowDurationMins?: number | null, resetsAt?: number | null } | null
  secondary?: { usedPercent?: number | null, windowDurationMins?: number | null, resetsAt?: number | null } | null
  credits?: { hasCredits?: boolean, unlimited?: boolean, balance?: string | null } | null
  planType?: string | null
  rateLimitReachedType?: string | null
}

export interface CodexModelProviderCapabilitiesReadResponse {
  namespaceTools?: boolean
  imageGeneration?: boolean
  webSearch?: boolean
}

export interface CodexModelListResponse {
  data?: Array<{
    id?: string
    model?: string
    displayName?: string
    supportedReasoningEfforts?: Array<{ reasoningEffort?: string, description?: string }>
    defaultReasoningEffort?: string
    hidden?: boolean
  }>
}

export interface CodexThreadItem {
  type?: string
  id?: string
  text?: string
  command?: string
  aggregatedOutput?: string | null
  exitCode?: number | null
  durationMs?: number | null
  source?: string
  server?: string
  tool?: string
  status?: string
  senderThreadId?: string
  receiverThreadIds?: string[]
  prompt?: string | null
  model?: string | null
  reasoningEffort?: string | null
  kind?: string
  agentThreadId?: string
  agentPath?: string
  agentsStates?: Record<string, { status?: string | null, message?: string | null } | undefined>
  error?: { message?: string } | string | null
  result?: unknown
  changes?: Array<{ path?: string }>
  query?: string
}

export interface CodexCompactSnapshot {
  threadId: string
  turnId: string | null
  tokenUsage: CodexThreadTokenUsage
  updatedAt: number
  status?: RuntimeCompactUiSlotState['status']
  compactionStartedAt?: number | null
  lastCompactedAt?: number | null
  compactionItemId?: string | null
  completedCompactionItemIds?: string[]
}

export interface CodexPlanSnapshot {
  threadId: string
  turnId: string | null
  explanation: string | null
  content: string | null
  steps: Array<{ step: string, status: RuntimePlanStepStatus }>
  updatedAt: number
}

export interface CodexToolActivitySnapshot {
  threadId: string
  turnId: string | null
  items: Array<{
    id: string
    type: string
    label: string
    status: RuntimeToolActivityStatus
    startedAt: number | null
    completedAt: number | null
    senderThreadId?: string | null
    receiverThreadIds?: string[]
    prompt?: string | null
    model?: string | null
    reasoningEffort?: string | null
    agentsStates?: Record<string, { status?: string | null, message?: string | null } | undefined>
  }>
  updatedAt: number
}

export interface CodexMcpServerSnapshot {
  name: string
  status: RuntimeMcpServerStatus
  authStatus: RuntimeMcpAuthStatus
  toolCount: number
  resourceCount: number
  error: string | null
}

export interface CodexMcpSnapshot {
  threadId: string
  servers: CodexMcpServerSnapshot[]
  recentProgress: string | null
  updatedAt: number
}

export interface CodexDiffSnapshot {
  threadId: string
  turnId: string | null
  files: Array<{
    path: string
    addedLines: number
    removedLines: number
  }>
  updatedAt: number
}

export interface CodexTerminalSnapshot {
  threadId: string
  turnId: string | null
  commands: Array<{
    id: string
    command: string | null
    status: RuntimeToolActivityStatus
    outputPreview: string | null
    updatedAt: number
  }>
  updatedAt: number
}

export interface CodexApprovalsSnapshot {
  threadId: string
  turnId: string | null
  items: Array<{
    id: string
    targetItemId: string | null
    status: RuntimeApprovalStatus
    label: string
    riskLevel: string | null
    rationale: string | null
    startedAt: number | null
    completedAt: number | null
  }>
  updatedAt: number
}

export interface CodexAlertSnapshot {
  threadId: string | null
  items: Array<{
    id: string
    severity: RuntimeAlertSeverity
    message: string
    source: string
    updatedAt: number
  }>
  updatedAt: number
}

export interface CodexFilesystemSnapshot {
  threadId: string
  recentPaths: string[]
  updatedAt: number
}

export interface CodexSearchSnapshot {
  threadId: string
  recentResultCount: number
  recentQuery: string | null
  fuzzySessionActive: boolean
  updatedAt: number
}

export interface CodexUsageSnapshot {
  threadId: string
  rateLimits: CodexRateLimitSnapshot
  updatedAt: number
}

export interface CodexListMcpServerStatusResponse {
  data?: Array<{
    name?: string
    tools?: Record<string, unknown>
    resources?: unknown[]
    resourceTemplates?: unknown[]
    authStatus?: string
  }>
  nextCursor?: string | null
}

export interface CodexSkillsListResponse {
  data?: Array<{
    cwd?: string
    skills?: Array<{ name?: string, enabled?: boolean }>
    errors?: unknown[]
  }>
}

export interface CodexPluginListResponse {
  marketplaces?: Array<{
    name?: string
    plugins?: Array<{ installed?: boolean, enabled?: boolean }>
  }>
  marketplaceLoadErrors?: unknown[]
}

export interface CodexAppsListResponse {
  data?: Array<{ id?: string, isAccessible?: boolean, isEnabled?: boolean }>
}

export interface CodexCollaborationModeListResponse {
  data?: Array<{ id?: string, name?: string, mode?: string | null, model?: string | null, reasoning_effort?: string | null }>
}

export interface McpServerStatusUpdatedNotificationParams {
  name?: string
  status?: string
  error?: string | null
}

export interface McpServerOauthLoginCompletedNotificationParams {
  name?: string
  success?: boolean
  error?: string
}

export interface CodexProviderSnapshot {
  workspacePath?: string
  agentId?: string | null
  agentHome?: string | null
  models?: {
    currentModelId?: string | null
    [key: string]: unknown
  }
  codex?: {
    compact?: CodexCompactSnapshot
    goal?: CodexGoalSnapshot | null
    sideConversation?: {
      threadId: string
      liveFork: boolean
      parentThreadId: string | null
      updatedAt: number
    }
    nativeHistory?: CodexNativeHistorySnapshot
    previousNativeHistory?: CodexNativeHistorySnapshot
    model?: {
      threadId: string
      modelId: string | null
      modelProvider: string | null
      serviceTier: string | null
      updatedAt: number
    }
    reasoning?: {
      threadId: string
      effort: string | null
      summary: string | null
      updatedAt: number
    }
    status?: {
      threadId: string
      status: CodexThreadStatus
      updatedAt: number
    }
    plan?: CodexPlanSnapshot
    toolActivity?: CodexToolActivitySnapshot
    mcp?: CodexMcpSnapshot
    diff?: CodexDiffSnapshot
    terminal?: CodexTerminalSnapshot
    approvals?: CodexApprovalsSnapshot
    alert?: CodexAlertSnapshot
    filesystem?: CodexFilesystemSnapshot
    search?: CodexSearchSnapshot
    usage?: CodexUsageSnapshot
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface CodexGoalSnapshot {
  threadId: string
  objective: string
  status: RuntimeGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export interface CodexGoalUpdatedNotificationParams {
  threadId?: string
  turnId?: string | null
  goal?: ThreadGoalGetResponse['goal']
}
