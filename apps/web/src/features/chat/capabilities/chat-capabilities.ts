import {
  getChatDraftRuntimeCapabilities,
  getChatSessionsBySessionIdBackgroundTerminals,
  getChatSessionsBySessionIdCapabilities,
  getChatSessionsBySessionIdContextUsage,
  getChatSessionsBySessionIdUiSlotStates,
  postChatSessionsBySessionIdBackgroundTerminalsByProcessIdTerminate,
} from '~/api-gen/sdk.gen'
import type { GetChatSessionsBySessionIdContextUsageResponse } from '~/api-gen/types.gen'

export function runtimeCapabilitiesQueryKey(sessionId: string | null): readonly unknown[] {
  return ['chat', 'runtime-capabilities', sessionId ?? 'no-session']
}

export function draftRuntimeCapabilitiesQueryKey(
  runtimeKind: string | null | undefined,
): readonly unknown[] {
  return ['chat', 'draft-runtime-capabilities', runtimeKind ?? 'no-runtime']
}

export function runtimeUiSlotStatesQueryKey(
  sessionId: string | null,
  runtimeKind?: string | null,
): readonly unknown[] {
  const key = ['chat', 'runtime-ui-slot-states', sessionId ?? 'no-session'] as const
  return runtimeKind ? [...key, runtimeKind] : key
}

export interface ChatSlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
}

export type ChatRuntimeUiSlotSurface
  = | 'slashCommand'
    | 'toolbarPicker'
    | 'composerState'
    | 'messageInline'
    | 'runtimePanel'
  // Stream evidence is rendered from provider-emitted message/tool chunks, not from polled slot state.
    | 'streamEvidence'
    | 'recordOnly'

export type ChatRuntimeUiSlotIconKey
  = | 'alert'
    | 'approvals'
    | 'code-review'
    | 'compact'
    | 'config'
    | 'crew'
    | 'diff'
    | 'feedback'
    | 'filesystem'
    | 'goal'
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

export type ChatRuntimeUiSlotCommandAction
  = | { kind: 'insertText' }
    | { kind: 'submitText', requiresEmptyComposer?: boolean }
    | { kind: 'uiAction', actionId: string }

export interface ChatRuntimeUiSlot {
  id: string
  name: string
  label: string
  description: string
  argumentHint: string
  aliases?: string[]
  iconKey?: ChatRuntimeUiSlotIconKey
  commandText?: string
  commandAction?: ChatRuntimeUiSlotCommandAction
  requiresSession?: boolean
  surfaces: ChatRuntimeUiSlotSurface[]
}

export interface ChatRuntimeCapabilities {
  runtimeKind: string
  slashCommands: ChatSlashCommand[]
  uiSlots: ChatRuntimeUiSlot[]
  skills: string[]
}

export type ChatRuntimeGoalStatus
  = | 'active'
    | 'paused'
    | 'blocked'
    | 'usageLimited'
    | 'budgetLimited'
    | 'complete'
export type ChatRuntimeCompactStatus = 'idle' | 'running' | 'nearLimit' | 'overLimit' | 'compacted'
export type ChatRuntimeThreadStatus = 'notLoaded' | 'idle' | 'systemError' | 'active'
export type ChatRuntimePlanStepStatus = 'pending' | 'inProgress' | 'completed'
export type ChatRuntimeToolActivityStatus = 'running' | 'completed' | 'failed'
export type ChatRuntimeMcpServerStatus = 'starting' | 'ready' | 'failed' | 'cancelled' | 'unknown'
export type ChatRuntimeMcpAuthStatus
  = | 'unsupported'
    | 'notLoggedIn'
    | 'bearerToken'
    | 'oAuth'
    | 'unknown'
export type ChatRuntimeApprovalStatus = 'pending' | 'approved' | 'denied' | 'timedOut' | 'aborted'
export type ChatRuntimeAlertSeverity = 'info' | 'warning' | 'error'

export interface ChatRuntimeTokenUsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export interface ChatRuntimeGoalUiSlotState {
  kind: 'goal'
  slotId: string
  threadId: string
  objective: string
  status: ChatRuntimeGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export interface ChatRuntimeCompactUiSlotState {
  kind: 'compact'
  slotId: string
  threadId: string
  turnId: string | null
  status: ChatRuntimeCompactStatus
  isCompactRelevant: boolean
  total: ChatRuntimeTokenUsageBreakdown
  last: ChatRuntimeTokenUsageBreakdown
  modelContextWindow: number | null
  autoCompactTokenLimit: number | null
  usagePercent: number | null
  autoCompactPercent: number | null
  lastCompactedAt: number | null
  compactionItemId: string | null
  updatedAt: number
}

export interface ChatRuntimeStatusUiSlotState {
  kind: 'status'
  slotId: string
  threadId: string
  status: ChatRuntimeThreadStatus
  activeFlags: string[]
  updatedAt: number
}

export interface ChatRuntimeModelUiSlotState {
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

export interface ChatRuntimeReasoningUiSlotState {
  kind: 'reasoning'
  slotId: string
  threadId: string
  effort: string | null
  summary: string | null
  supportedEfforts: Array<{ id: string, description: string }>
  updatedAt: number
}

export interface ChatRuntimePlanStep {
  step: string
  status: ChatRuntimePlanStepStatus
}

export interface ChatRuntimePlanUiSlotState {
  kind: 'plan'
  slotId: string
  threadId: string
  turnId: string | null
  explanation: string | null
  content: string | null
  steps: ChatRuntimePlanStep[]
  currentStep: string | null
  pendingCount: number
  inProgressCount: number
  completedCount: number
  updatedAt: number
}

export interface ChatRuntimeProgressItem {
  id: string | null
  label: string
  status: ChatRuntimePlanStepStatus
  sourceStatus: string | null
}

export interface ChatRuntimeProgressUiSlotState {
  kind: 'progress'
  slotId: string
  threadId: string
  turnId: string | null
  source: string
  items: ChatRuntimeProgressItem[]
  currentItem: string | null
  pendingCount: number
  inProgressCount: number
  completedCount: number
  updatedAt: number
}

export interface ChatRuntimeToolActivityItem {
  id: string
  type: string
  label: string
  status: ChatRuntimeToolActivityStatus
  startedAt: number | null
  completedAt: number | null
}

export interface ChatRuntimeToolActivityUiSlotState {
  kind: 'toolActivity'
  slotId: string
  threadId: string
  turnId: string | null
  activeCount: number
  completedCount: number
  failedCount: number
  recentItems: ChatRuntimeToolActivityItem[]
  updatedAt: number
}

export interface ChatRuntimeCrewCollaborationMode {
  name: string
  mode: string | null
  model: string | null
  reasoningEffort: string | null
}

export interface ChatRuntimeCrewAgentItem {
  threadId: string
  status: string | null
  message: string | null
  name: string | null
  preview: string | null
  modelProvider: string | null
  agentNickname: string | null
  agentRole: string | null
}

export interface ChatRuntimeCrewCallItem {
  id: string
  tool: string
  status: ChatRuntimeToolActivityStatus
  senderThreadId: string | null
  receiverThreadIds: string[]
  prompt: string | null
  model: string | null
  reasoningEffort: string | null
  agents: ChatRuntimeCrewAgentItem[]
  startedAt: number | null
  completedAt: number | null
}

export interface ChatRuntimeMcpServerSummary {
  name: string
  status: ChatRuntimeMcpServerStatus
  authStatus: ChatRuntimeMcpAuthStatus
  toolCount: number
  resourceCount: number
  error: string | null
}

export interface ChatRuntimeMcpUiSlotState {
  kind: 'mcp'
  slotId: string
  threadId: string
  serverCount: number
  readyCount: number
  failedCount: number
  needsLoginCount: number
  recentProgress: string | null
  servers: ChatRuntimeMcpServerSummary[]
  updatedAt: number
}

export interface ChatRuntimeDiffUiSlotState {
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

export interface ChatRuntimeBackgroundTerminal {
  itemId: string
  processId: string
  command: string
  cwd: string
  osPid: number | null
  cpuPercent: number | null
  rssKb: number | null
}

export interface ChatRuntimeTerminalUiSlotState {
  kind: 'terminal'
  slotId: string
  threadId: string
  turnId: string | null
  activeCount: number
  completedCount: number
  failedCount: number
  lastCommand: string | null
  lastOutputPreview: string | null
  backgroundTerminals: ChatRuntimeBackgroundTerminal[]
  updatedAt: number
}

export interface ChatRuntimeApprovalItem {
  id: string
  targetItemId: string | null
  status: ChatRuntimeApprovalStatus
  label: string
  riskLevel: string | null
  rationale: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface ChatRuntimeApprovalsUiSlotState {
  kind: 'approvals'
  slotId: string
  threadId: string
  turnId: string | null
  pendingCount: number
  approvedCount: number
  deniedCount: number
  recentItems: ChatRuntimeApprovalItem[]
  updatedAt: number
}

export interface ChatRuntimeAlertItem {
  id: string
  severity: ChatRuntimeAlertSeverity
  message: string
  source: string
  updatedAt: number
}

export interface ChatRuntimeAlertUiSlotState {
  kind: 'alert'
  slotId: string
  threadId: string | null
  warningCount: number
  errorCount: number
  recentItems: ChatRuntimeAlertItem[]
  updatedAt: number
}

export interface ChatRuntimeFilesystemUiSlotState {
  kind: 'filesystem'
  slotId: string
  threadId: string
  changedPathCount: number
  recentPaths: string[]
  updatedAt: number
}

export interface ChatRuntimeSkillsUiSlotState {
  kind: 'skills'
  slotId: string
  threadId: string
  enabledCount: number
  disabledCount: number
  errorCount: number
  roots: string[]
  updatedAt: number
}

export interface ChatRuntimePluginUiSlotState {
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

export interface ChatRuntimeSearchUiSlotState {
  kind: 'search'
  slotId: string
  threadId: string
  recentResultCount: number
  recentQuery: string | null
  fuzzySessionActive: boolean
  updatedAt: number
}

export interface ChatRuntimeCrewUiSlotState {
  kind: 'crew'
  slotId: string
  threadId: string
  activeCount: number
  completedCount: number
  failedCount: number
  recentItems: ChatRuntimeToolActivityItem[]
  agents: ChatRuntimeCrewAgentItem[]
  collaborationModeCount: number
  collaborationModes: ChatRuntimeCrewCollaborationMode[]
  calls: ChatRuntimeCrewCallItem[]
  updatedAt: number
}

export interface ChatRuntimeUsageUiSlotState {
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

export interface ChatRuntimeConfigUiSlotState {
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

export interface ChatRuntimeUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  multiSelect: boolean
  options: Array<{ label: string, description: string }> | null
}

export interface ChatRuntimeUserInputUiSlotState {
  kind: 'userInput'
  slotId: string
  threadId: string | null
  runId: string
  requestId: string
  providerMethod: string
  toolCallId: string
  questionCount: number
  questions: ChatRuntimeUserInputQuestion[]
  createdAt: number
  updatedAt: number
}

export type ChatRuntimeUiSlotState
  = | ChatRuntimeAlertUiSlotState
    | ChatRuntimeApprovalsUiSlotState
    | ChatRuntimeCompactUiSlotState
    | ChatRuntimeConfigUiSlotState
    | ChatRuntimeCrewUiSlotState
    | ChatRuntimeDiffUiSlotState
    | ChatRuntimeFilesystemUiSlotState
    | ChatRuntimeGoalUiSlotState
    | ChatRuntimeMcpUiSlotState
    | ChatRuntimeModelUiSlotState
    | ChatRuntimePlanUiSlotState
    | ChatRuntimeProgressUiSlotState
    | ChatRuntimePluginUiSlotState
    | ChatRuntimeReasoningUiSlotState
    | ChatRuntimeSearchUiSlotState
    | ChatRuntimeSkillsUiSlotState
    | ChatRuntimeStatusUiSlotState
    | ChatRuntimeTerminalUiSlotState
    | ChatRuntimeToolActivityUiSlotState
    | ChatRuntimeUsageUiSlotState
    | ChatRuntimeUserInputUiSlotState

export interface ChatRuntimeUiSlotStatesResponse {
  runtimeKind: string
  states: ChatRuntimeUiSlotState[]
}

export interface ChatRuntimeBackgroundTerminalsResponse {
  runtimeKind: string
  providerSessionId: string | null
  terminals: ChatRuntimeBackgroundTerminal[]
  nextCursor: string | null
}

export interface ChatRuntimeBackgroundTerminalTerminateResponse {
  runtimeKind: string
  providerSessionId: string | null
  processId: string
  terminated: boolean
}

export type ChatRuntimeContextUsageResponse = GetChatSessionsBySessionIdContextUsageResponse
export type ChatRuntimeContextUsage = NonNullable<ChatRuntimeContextUsageResponse['usage']>
export type ChatRuntimeContextUsageSection = ChatRuntimeContextUsage['sections'][number]
export type ChatRuntimeContextUsageItem = ChatRuntimeContextUsageSection['items'][number]

function readChatCapabilityData<T>(
  result: { data?: T, error?: unknown, response?: Response },
  errorPrefix: string,
): T {
  if (result.error || result.data === undefined) {
    throw new Error(`${errorPrefix}: ${result.response?.status ?? 'unknown'} ${stringifyChatCapabilityError(result.error)}`)
  }
  return result.data
}

function stringifyChatCapabilityError(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}

export async function getChatRuntimeCapabilities(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ChatRuntimeCapabilities> {
  const result = await getChatSessionsBySessionIdCapabilities({
    path: { sessionId },
    signal,
  })
  return readChatCapabilityData(result, 'Failed to load chat capabilities') as ChatRuntimeCapabilities
}

export async function getDraftChatRuntimeCapabilities(
  runtimeKind: string,
  signal?: AbortSignal,
): Promise<ChatRuntimeCapabilities> {
  const result = await getChatDraftRuntimeCapabilities({
    query: { runtimeKind },
    signal,
  })
  return readChatCapabilityData(result, 'Failed to load draft chat capabilities') as ChatRuntimeCapabilities
}

export async function getChatRuntimeUiSlotStates(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ChatRuntimeUiSlotStatesResponse> {
  const result = await getChatSessionsBySessionIdUiSlotStates({
    path: { sessionId },
    signal,
  })
  return readChatCapabilityData(result, 'Failed to load chat UI slot states') as ChatRuntimeUiSlotStatesResponse
}

export async function getChatRuntimeBackgroundTerminals(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ChatRuntimeBackgroundTerminalsResponse> {
  const result = await getChatSessionsBySessionIdBackgroundTerminals({
    path: { sessionId },
    signal,
  })
  return readChatCapabilityData(result, 'Failed to load background terminals') as ChatRuntimeBackgroundTerminalsResponse
}

export async function terminateChatRuntimeBackgroundTerminal(
  sessionId: string,
  processId: string,
): Promise<ChatRuntimeBackgroundTerminalTerminateResponse> {
  const result = await postChatSessionsBySessionIdBackgroundTerminalsByProcessIdTerminate({
    path: { sessionId, processId },
  })
  return readChatCapabilityData(result, 'Failed to terminate background terminal') as ChatRuntimeBackgroundTerminalTerminateResponse
}

export async function getChatRuntimeContextUsage(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ChatRuntimeContextUsageResponse> {
  const result = await getChatSessionsBySessionIdContextUsage({
    path: { sessionId },
    signal,
  })
  return readChatCapabilityData(result, 'Failed to load chat context usage')
}
