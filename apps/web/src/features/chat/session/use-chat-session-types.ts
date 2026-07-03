import type { UIMessage } from 'ai'

import type { ChatRunState } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'

import type { ChatContinuationMode, ChatQueueItem, ChatRuntimeSettingsPatch, ChatThinkingEffort } from '../commands/chat-response-command'
import type { RuntimeSessionRunStatus } from '../commands/runtime-session-status-command'

// ── Message Snapshot Types ──────────────────────────────────

export interface ChatSessionMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: string
  errorText?: string | null
  content: string
  message: UIMessage
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}
export type { ChatContinuationMode, ChatQueueItem }

export interface SendMessageOptions {
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort | null | undefined
  runtimeSettings?: ChatRuntimeSettingsPatch
  continuationMode?: ChatContinuationMode
}

export type SendMessageResult = void | {
  kind: 'side-conversation'
  sideConversationId: string
  parentSessionId: string
}

export interface ToolApprovalResponseInput {
  messageId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export interface RuntimeUserInputSubmitInput {
  messageId: string
  toolCallId: string
  answers: Record<string, string[]>
}

// ── Utility Functions ──────────────────────────────────────

export function projectMainMessagesFromSnapshotRows(rows: ChatSessionMessageRow[]): UIMessage[] {
  return rows.flatMap((row) => {
    if (row.parentToolCallId) {
      return []
    }
    return [row.message]
  })
}

export function projectStreamingMainAssistantMessageIds(rows: ChatSessionMessageRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.role !== 'assistant' || row.status !== 'streaming' || row.parentToolCallId) {
      return []
    }
    return [row.messageId]
  })
}

export type PublicStatus = import('~/store/chat').PublicStatus

export function derivePassiveStatus(rows: ChatSessionMessageRow[]): PublicStatus {
  if (rows.some(row => row.status === 'streaming')) {
    return 'streaming'
  }
  const latestAssistant = [...rows].reverse().find(row => row.role === 'assistant')
  if (latestAssistant?.status === 'failed') {
    return 'error'
  }
  return 'idle'
}

export function readLatestFailedMainAssistantRow(rows: ChatSessionMessageRow[]): ChatSessionMessageRow | undefined {
  const latestAssistant = [...rows]
    .reverse()
    .find(row => row.role === 'assistant' && !row.parentToolCallId)
  return latestAssistant?.status === 'failed' ? latestAssistant : undefined
}

export function isEmptyStreamingMainAssistantRow(row: ChatSessionMessageRow): boolean {
  return row.role === 'assistant'
    && row.status === 'streaming'
    && !row.parentToolCallId
    && row.message.parts.length === 0
}

export function shouldHoldEmptyStreamingSnapshot(input: {
  rows: ChatSessionMessageRow[]
  runtimeStatusKnown: boolean
  runtimeIdle: boolean
  snapshotFetching: boolean
}): boolean {
  if (!input.rows.some(isEmptyStreamingMainAssistantRow)) {
    return false
  }
  if (input.snapshotFetching) {
    return true
  }
  if (!input.runtimeStatusKnown) {
    return true
  }
  return input.runtimeIdle
}

export function projectRowsWithoutEmptyStreamingAssistant(rows: ChatSessionMessageRow[]): ChatSessionMessageRow[] {
  return rows.filter(row => !isEmptyStreamingMainAssistantRow(row))
}

export function readStableSnapshotRows(rows: ChatSessionMessageRow[]): ChatSessionMessageRow[] | null {
  return rows.some(row => row.status === 'streaming') ? null : rows
}

export function isMatchingApprovalPart(part: UIMessage['parts'][number], approvalId: string): boolean {
  if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
    return false
  }
  const approval = (part as { approval?: { id?: unknown } }).approval
  return typeof approval?.id === 'string' && approval.id === approvalId
}

export function isMatchingToolPart(part: UIMessage['parts'][number], toolCallId: string): boolean {
  return (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
    && (part as { toolCallId?: unknown }).toolCallId === toolCallId
}

export function readRuntimeUserInputRequestId(toolCallId: string): string {
  return toolCallId.startsWith('server-request-')
    ? toolCallId.slice('server-request-'.length)
    : toolCallId
}

export function isTerminalChatRunStatus(status: RuntimeSessionRunStatus['status']): boolean {
  return status === 'complete' || status === 'failed' || status === 'aborted'
}

export function readLocalDriverMessageId(runState: ChatRunState): string | undefined {
  if (runState.phase === 'submitting') {
    return runState.messageId
  }
  if (runState.phase === 'streaming' && runState.source === 'local') {
    return runState.messageId
  }
  return undefined
}

export function isChatRunStateLocallyDriven(runState: ChatRunState): boolean {
  return Boolean(readLocalDriverMessageId(runState))
}

export function isChatRunStateCancelling(runState: ChatRunState): boolean {
  return runState.phase === 'settling' && runState.cancelling
}

export function isChatRunStateStreaming(runState: ChatRunState): boolean {
  return runState.phase === 'submitting' || runState.phase === 'streaming'
}

export function releaseSessionStreamingStateForTerminalRun(
  sessionId: string,
  run: RuntimeSessionRunStatus | null | undefined,
): boolean {
  if (!run || !run.runId || !isTerminalChatRunStatus(run.status)) {
    return false
  }

  const state = useChatStore.getState()
  const localDriverMessageId = readLocalDriverMessageId(chatSelectors.sessionRunState(sessionId)(state))
  const sessionMessageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))
  if (localDriverMessageId) {
    sessionMessageIds.add(localDriverMessageId)
  }

  const candidateMessageIds = new Set<string>()
  if (run.messageId) {
    candidateMessageIds.add(run.messageId)
    const split = state.assistantDisplaySplitMap.get(run.messageId)
    if (split) {
      candidateMessageIds.add(split.tailMessageId)
    }
  }

  for (const messageId of sessionMessageIds) {
    if (state.runDisplayMetaMap.get(messageId)?.runId === run.runId) {
      candidateMessageIds.add(messageId)
    }
  }

  let released = false
  for (const messageId of candidateMessageIds) {
    if (!sessionMessageIds.has(messageId) && localDriverMessageId !== messageId) {
      continue
    }
    const runDisplayId = state.runDisplayMetaMap.get(messageId)?.runId
    const matchesTerminalRun = runDisplayId ? runDisplayId === run.runId : messageId === run.messageId
    if (!matchesTerminalRun) {
      continue
    }
    const runMeta = state.runDisplayMetaMap.get(messageId)
    if (
      chatSelectors.isStreamingMessage(messageId)(state)
      || localDriverMessageId === messageId
      || runMeta?.completedAtMs === null
    ) {
      state.finishGeneration(messageId)
      released = true
    }
  }

  if (released) {
    const nextState = useChatStore.getState()
    const nextSessionMessageIds = new Set((nextState.messagesMap.get(sessionId) ?? []).map(message => message.id))
    const hasRemainingStreamingRefs = [...nextSessionMessageIds].some(messageId =>
      chatSelectors.isStreamingMessage(messageId)(nextState))
    if (!hasRemainingStreamingRefs && isChatRunStateStreaming(chatSelectors.sessionRunState(sessionId)(nextState))) {
      nextState.setPassiveRunState(sessionId, { messageIds: [], status: 'idle' })
    }
  }

  return released
}

// ── Constants ──────────────────────────────────────────────

export const SNAPSHOT_SYNC_DEBOUNCE_MS = 75
export const QUEUE_DRAIN_SYNC_DELAY_MS = 150
export const EMPTY_QUEUE_ITEMS: ChatQueueItem[] = []
export const BANG_COMMAND_DRIVER_PREFIX = 'bang-command'
export const STEER_FALLBACK_ERROR_CODES = new Set(['chat_steer_context_mismatch', 'chat_steer_no_active_run'])
export const CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:'
export const CODEX_PLAN_IMPLEMENTATION_APPROVAL_PREFIX = 'implement-plan:'

// ── Internal Helpers ──────────────────────────────────────

export interface PlanImplementationApprovalRequest {
  toolCallId: string
  planContent: string
}

export interface RuntimeToolApprovalRequest {
  requestId: string
  toolCallId: string
}

const RUNTIME_TOOL_APPROVAL_API_NAMES = new Set([
  'approval.command_execution',
  'approval.file_change',
  'approval.permissions',
  'approval.apply_patch',
  'approval.exec_command',
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readBuiltinToolCallInputPayload(value: unknown): { identifier: string | null, apiName: string, args: unknown } | null {
  if (!isRecord(value) || value.type !== 'cradle.builtin-tool-call.input.v1' || typeof value.apiName !== 'string') {
    return null
  }
  return {
    identifier: typeof value.identifier === 'string' ? value.identifier : null,
    apiName: value.apiName,
    args: value.args,
  }
}

export function readToolApiName(part: UIMessage['parts'][number]): string | null {
  const inputPayload = readBuiltinToolCallInputPayload((part as { input?: unknown }).input)
  if (inputPayload) {
    return inputPayload.apiName
  }
  const toolName = (part as { toolName?: unknown }).toolName
  if (typeof toolName === 'string') {
    return toolName
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

export function readPlanContentFromInput(input: unknown): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(input)
  const args = inputPayload ? inputPayload.args : input
  if (!isRecord(args) || typeof args.planContent !== 'string') {
    return null
  }
  const planContent = args.planContent.trim()
  return planContent.length > 0 ? planContent : null
}

export function readPlanImplementationApprovalRequest(
  messages: UIMessage[],
  response: ToolApprovalResponseInput,
): PlanImplementationApprovalRequest | null {
  if (!response.approvalId.startsWith(CODEX_PLAN_IMPLEMENTATION_APPROVAL_PREFIX)) {
    return null
  }
  const message = messages.find(item => item.id === response.messageId)
  const part = message?.parts.find(item => isMatchingApprovalPart(item, response.approvalId))
  if (!part || !('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return null
  }
  if (part.toolCallId !== response.approvalId || readToolApiName(part) !== 'plan_implementation') {
    return null
  }
  const planContent = readPlanContentFromInput((part as { input?: unknown }).input)
  return planContent ? { toolCallId: part.toolCallId, planContent } : null
}

export function readRuntimeToolApprovalRequest(
  messages: UIMessage[],
  response: ToolApprovalResponseInput,
): RuntimeToolApprovalRequest | null {
  const message = messages.find(item => item.id === response.messageId)
  const part = message?.parts.find(item => isMatchingApprovalPart(item, response.approvalId))
  if (!part || !('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return null
  }
  if (part.toolCallId !== response.approvalId) {
    return null
  }
  const inputPayload = readBuiltinToolCallInputPayload((part as { input?: unknown }).input)
  const apiName = readToolApiName(part)
  if (
    !response.approvalId.startsWith('server-request-')
    && inputPayload?.identifier !== 'claude-code'
  ) {
    return null
  }
  if (
    !apiName
    || (
      inputPayload?.identifier !== 'claude-code'
      && !RUNTIME_TOOL_APPROVAL_API_NAMES.has(apiName)
    )
  ) {
    return null
  }
  return {
    requestId: readRuntimeUserInputRequestId(response.approvalId),
    toolCallId: part.toolCallId,
  }
}

export function readSideChatCommand(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/side')) {
    return null
  }
  const nextChar = normalized.charAt('/side'.length)
  if (nextChar && nextChar !== ' ' && nextChar !== '\t') {
    return null
  }
  return normalized.slice('/side'.length).trim()
}

export function detachPassiveSessionStreamingState(sessionId: string): void {
  useChatStore.getState().setPassiveRunState(sessionId, {
    messageIds: [],
    status: 'idle',
  })
}
