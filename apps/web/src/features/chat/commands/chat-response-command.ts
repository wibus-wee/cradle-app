import type { FileUIPart, UIMessage } from 'ai'
import { z } from 'zod'

import {
  deleteChatSessionsBySessionIdQueueByQueueItemId,
  deleteChatSideConversationsBySideConversationId,
  getChatSessionsBySessionIdQueue,
  patchChatSessionsBySessionIdQueueByQueueItemId,
  postChatSessionsBySessionIdBangCommand,
  postChatSessionsBySessionIdCancel,
  postChatSessionsBySessionIdMessagesByMessageIdPlanImplementationApproval,
  postChatSessionsBySessionIdQueue,
  postChatSessionsBySessionIdQueueReorder,
  postChatSessionsBySessionIdSideChat,
  postChatSessionsBySessionIdSteer,
  postChatSessionsBySessionIdToolApprovalByRequestId,
  postChatSessionsBySessionIdUserInputByRequestId,
} from '~/api-gen/sdk.gen'
import { getServerUrl } from '~/lib/electron'

import type { ChatContextPart } from '../context/chat-context-parts'

const SERVER_BASE = getServerUrl()

export type ChatThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type ChatContinuationMode = 'queue' | 'steer'

export interface ChatResponseRequestBody {
  text: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
}

export type ChatQueueMode = 'queue'
export type ChatQueueItemStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
export type ChatRuntimeAccessMode = 'approval-required' | 'full-access'
export type ChatRuntimeInteractionMode = 'default' | 'plan'

export interface ChatRuntimeSettings {
  accessMode: ChatRuntimeAccessMode
  interactionMode: ChatRuntimeInteractionMode
}

export type ChatRuntimeSettingsPatch = Partial<ChatRuntimeSettings>

export interface ChatQueueItem {
  id: string
  sessionId: string
  mode: ChatQueueMode
  status: ChatQueueItemStatus
  text: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: ChatThinkingEffort | null
  runtimeSettings: ChatRuntimeSettings
  position: number
  sourceRunId: string | null
  startedRunId: string | null
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export interface ChatQueueListResponse {
  items: ChatQueueItem[]
}

export interface ChatSteerTurnResponse {
  ok: true
  sessionId: string
  runId: string
  sourceMessageId: string
  message: UIMessage
}

export interface PlanImplementationApprovalResult {
  message: UIMessage
}

export interface SideChatResult {
  sideConversationId: string
  parentSessionId: string
  runtimeKind: string
  providerTargetId: string | null
  providerSessionId: string | null
  title: string
  expiresAt: number
}

export interface BangCommandResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
  userMessageId: string
  resultMessageId: string
  userMessage: UIMessage
  resultMessage: UIMessage
}

export type ChatQueueEnqueueBody = ChatResponseRequestBody
export interface ChatSteerBody {
  text: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  providerTargetId?: string
}

const ChatThinkingEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
const ChatRuntimeSettingsSchema = z.object({
  accessMode: z.enum(['approval-required', 'full-access']).default('approval-required'),
  interactionMode: z.enum(['default', 'plan']).default('default'),
})
const ChatQueueItemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  mode: z.literal('queue'),
  status: z.enum(['pending', 'running', 'cancelled', 'completed', 'failed']),
  text: z.string(),
  files: z.array(z.unknown()).default([]),
  contextParts: z.array(z.unknown()).default([]),
  providerTargetId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingEffort: ChatThinkingEffortSchema.nullable().catch(null),
  runtimeSettings: ChatRuntimeSettingsSchema,
  position: z.number(),
  sourceRunId: z.string().nullable(),
  startedRunId: z.string().nullable(),
  errorText: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).transform(item => ({
  ...item,
  files: item.files as FileUIPart[],
  contextParts: item.contextParts as ChatContextPart[],
}))
const ChatQueueListResponseSchema = z.object({
  items: z.array(ChatQueueItemSchema),
})
const ChatSteerTurnResponseSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  runId: z.string(),
  sourceMessageId: z.string(),
  message: z.unknown(),
}).transform(item => ({
  ...item,
  message: item.message as UIMessage,
}))
const PlanImplementationApprovalResponseSchema = z.object({
  message: z.unknown(),
}).transform(item => ({
  message: item.message as UIMessage,
}))

function parseChatQueueItem(value: unknown): ChatQueueItem {
  return ChatQueueItemSchema.parse(value) satisfies ChatQueueItem
}

function parseChatQueueListResponse(value: unknown): ChatQueueListResponse {
  return ChatQueueListResponseSchema.parse(value) satisfies ChatQueueListResponse
}

function parseChatSteerTurnResponse(value: unknown): ChatSteerTurnResponse {
  return ChatSteerTurnResponseSchema.parse(value) satisfies ChatSteerTurnResponse
}

function parsePlanImplementationApprovalResponse(value: unknown): PlanImplementationApprovalResult {
  return PlanImplementationApprovalResponseSchema.parse(value) satisfies PlanImplementationApprovalResult
}

function stringifySdkError(error: unknown): string {
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

function throwSdkCommandError(prefix: string, response: Response | undefined, error: unknown): never {
  const bodyText = stringifySdkError(error)
  throw Object.assign(
    new Error(`${prefix}: ${response?.status ?? 'unknown'} ${bodyText}`),
    {
      bodyText,
      code: readJsonErrorCodeFromText(bodyText),
      status: response?.status,
    },
  )
}

function readSdkData<T>(
  result: { data?: T, error?: unknown, response?: Response },
  errorPrefix: string,
): T {
  if (result.error || result.data === undefined) {
    throwSdkCommandError(errorPrefix, result.response, result.error)
  }
  return result.data
}

export function readJsonErrorCodeFromText(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) {
    return null
  }

  try {
    const body = JSON.parse(text.slice(start, end + 1)) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  }
  catch {
    return null
  }
}

export function readChatCommandErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') {
    return code
  }
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? readJsonErrorCodeFromText(message) : null
}

export function buildChatResponseRequestBody(
  body: ChatResponseRequestBody,
): ChatResponseRequestBody {
  return {
    text: body.text,
    files: body.files,
    contextParts: body.contextParts,
    messages: body.messages,
    providerTargetId: body.providerTargetId ?? undefined,
    modelId: body.modelId ?? undefined,
    thinkingEffort: body.thinkingEffort ?? undefined,
    runtimeSettings: body.runtimeSettings ?? undefined,
  }
}

export async function startChatResponse(args: {
  sessionId: string
  body: ChatResponseRequestBody
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatResponseRequestBody(args.body)),
    signal: args.signal,
  })
}

export async function subscribeChatSessionStream(args: {
  sessionId: string
  signal?: AbortSignal
}): Promise<Response> {
  const url = new URL(`${SERVER_BASE}/chat/sessions/${args.sessionId}/stream`)
  return fetch(url.toString(), {
    method: 'GET',
    signal: args.signal,
  })
}

export async function executeBangCommand(args: {
  sessionId: string
  command: string
  signal?: AbortSignal
}): Promise<BangCommandResult> {
  const result = await postChatSessionsBySessionIdBangCommand({
    path: { sessionId: args.sessionId },
    body: { command: args.command },
    signal: args.signal,
  })
  return readSdkData(result, 'Failed to execute bang command') as BangCommandResult
}

export async function createSideChat(args: {
  sessionId: string
  providerTargetId?: string
  modelId?: string | null
  signal?: AbortSignal
}): Promise<SideChatResult> {
  const result = await postChatSessionsBySessionIdSideChat({
    path: { sessionId: args.sessionId },
    body: {
      providerTargetId: args.providerTargetId,
      modelId: args.modelId,
    },
    signal: args.signal,
  })
  return readSdkData(result, 'Failed to create side chat') as SideChatResult
}

export async function startSideConversationResponse(args: {
  sideConversationId: string
  body: Omit<ChatResponseRequestBody, 'providerTargetId' | 'messages'>
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${SERVER_BASE}/chat/side-conversations/${args.sideConversationId}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatResponseRequestBody({
      text: args.body.text,
      files: args.body.files,
      contextParts: args.body.contextParts,
      modelId: args.body.modelId,
      thinkingEffort: args.body.thinkingEffort,
      runtimeSettings: args.body.runtimeSettings,
    })),
    signal: args.signal,
  })
}

export async function releaseSideConversation(sideConversationId: string): Promise<void> {
  await deleteChatSideConversationsBySideConversationId({
    path: { sideConversationId },
  }).catch(() => undefined)
}

export async function listChatSessionQueue(sessionId: string): Promise<ChatQueueListResponse> {
  const result = await getChatSessionsBySessionIdQueue({
    path: { sessionId },
  })
  return parseChatQueueListResponse(readSdkData(result, 'Failed to list chat queue'))
}

export async function enqueueChatSessionQueueItem(args: {
  sessionId: string
  body: ChatQueueEnqueueBody
}): Promise<ChatQueueItem> {
  const result = await postChatSessionsBySessionIdQueue({
    path: { sessionId: args.sessionId },
    body: buildChatResponseRequestBody(args.body),
  })
  return parseChatQueueItem(readSdkData(result, 'Failed to enqueue chat continuation'))
}

export async function steerChatSessionTurn(args: {
  sessionId: string
  body: ChatSteerBody
}): Promise<ChatSteerTurnResponse> {
  const result = await postChatSessionsBySessionIdSteer({
    path: { sessionId: args.sessionId },
    body: {
      text: args.body.text,
      files: args.body.files,
      contextParts: args.body.contextParts,
      providerTargetId: args.body.providerTargetId ?? undefined,
    },
  })

  return parseChatSteerTurnResponse(readSdkData(result, 'Failed to steer chat turn'))
}

export async function cancelChatSessionQueueItem(args: {
  sessionId: string
  queueItemId: string
}): Promise<ChatQueueItem> {
  const result = await deleteChatSessionsBySessionIdQueueByQueueItemId({
    path: { sessionId: args.sessionId, queueItemId: args.queueItemId },
  })
  return parseChatQueueItem(readSdkData(result, 'Failed to cancel chat queue item'))
}

export async function updateChatSessionQueueItem(args: {
  sessionId: string
  queueItemId: string
  body: ChatQueueEnqueueBody
}): Promise<ChatQueueItem> {
  const result = await patchChatSessionsBySessionIdQueueByQueueItemId({
    path: { sessionId: args.sessionId, queueItemId: args.queueItemId },
    body: buildChatResponseRequestBody(args.body),
  })

  return parseChatQueueItem(readSdkData(result, 'Failed to update chat queue item'))
}

export async function reorderChatSessionQueue(args: {
  sessionId: string
  queueItemIds: string[]
}): Promise<ChatQueueListResponse> {
  const result = await postChatSessionsBySessionIdQueueReorder({
    path: { sessionId: args.sessionId },
    body: { queueItemIds: args.queueItemIds },
  })
  return parseChatQueueListResponse(readSdkData(result, 'Failed to reorder chat queue'))
}

export async function cancelChatResponse(sessionId: string): Promise<void> {
  const result = await postChatSessionsBySessionIdCancel({
    path: { sessionId },
  })
  readSdkData(result, 'Failed to cancel chat response')
}

export async function submitRuntimeUserInput(args: {
  sessionId: string
  requestId: string
  answers: Record<string, string[]>
  signal?: AbortSignal
}): Promise<{ requestId: string, answers: Record<string, string[]> }> {
  const result = await postChatSessionsBySessionIdUserInputByRequestId({
    path: { sessionId: args.sessionId, requestId: args.requestId },
    body: { answers: args.answers },
    signal: args.signal,
  })
  return readSdkData(result, 'Failed to submit runtime user input') as { requestId: string, answers: Record<string, string[]> }
}

export async function submitRuntimeToolApproval(args: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
  signal?: AbortSignal
}): Promise<{ requestId: string, approved: boolean, reason?: string }> {
  const result = await postChatSessionsBySessionIdToolApprovalByRequestId({
    path: { sessionId: args.sessionId, requestId: args.requestId },
    body: {
      approved: args.approved,
      ...(args.reason ? { reason: args.reason } : {}),
    },
    signal: args.signal,
  })
  return readSdkData(result, 'Failed to submit runtime tool approval')
}

export async function resolvePlanImplementationApproval(args: {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
  signal?: AbortSignal
}): Promise<PlanImplementationApprovalResult> {
  const result = await postChatSessionsBySessionIdMessagesByMessageIdPlanImplementationApproval({
    path: { sessionId: args.sessionId, messageId: args.messageId },
    body: {
      approvalId: args.approvalId,
      approved: args.approved,
    },
    signal: args.signal,
  })
  return parsePlanImplementationApprovalResponse(readSdkData(result, 'Failed to resolve plan implementation approval'))
}
