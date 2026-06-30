import type { FileUIPart, UIMessage } from 'ai'
import { z } from 'zod'

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
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/bang-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: args.command }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to execute bang command: ${res.status} ${body}`)
  }

  return await res.json() as BangCommandResult
}

export async function createSideChat(args: {
  sessionId: string
  providerTargetId?: string
  modelId?: string | null
  signal?: AbortSignal
}): Promise<SideChatResult> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/side-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerTargetId: args.providerTargetId,
      modelId: args.modelId,
    }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to create side chat: ${res.status} ${body}`)
  }

  return await res.json() as SideChatResult
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
  await fetch(`${SERVER_BASE}/chat/side-conversations/${sideConversationId}`, {
    method: 'DELETE',
  }).catch(() => undefined)
}

export async function listChatSessionQueue(sessionId: string): Promise<ChatQueueListResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/queue`)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to list chat queue: ${res.status} ${body}`)
  }

  return parseChatQueueListResponse(await res.json())
}

export async function enqueueChatSessionQueueItem(args: {
  sessionId: string
  body: ChatQueueEnqueueBody
}): Promise<ChatQueueItem> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args.body),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to enqueue chat continuation: ${res.status} ${body}`)
  }

  return parseChatQueueItem(await res.json())
}

export async function steerChatSessionTurn(args: {
  sessionId: string
  body: ChatSteerBody
}): Promise<ChatSteerTurnResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/steer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: args.body.text,
      files: args.body.files,
      contextParts: args.body.contextParts,
      providerTargetId: args.body.providerTargetId ?? undefined,
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`Failed to steer chat turn: ${res.status} ${bodyText}`),
      {
        bodyText,
        code: readJsonErrorCodeFromText(bodyText),
        status: res.status,
      },
    )
  }

  return parseChatSteerTurnResponse(await res.json())
}

export async function cancelChatSessionQueueItem(args: {
  sessionId: string
  queueItemId: string
}): Promise<ChatQueueItem> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue/${args.queueItemId}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to cancel chat queue item: ${res.status} ${body}`)
  }

  return parseChatQueueItem(await res.json())
}

export async function updateChatSessionQueueItem(args: {
  sessionId: string
  queueItemId: string
  body: ChatQueueEnqueueBody
}): Promise<ChatQueueItem> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue/${args.queueItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args.body),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`Failed to update chat queue item: ${res.status} ${body}`),
      {
        bodyText: body,
        code: readJsonErrorCodeFromText(body),
        status: res.status,
      },
    )
  }

  return parseChatQueueItem(await res.json())
}

export async function reorderChatSessionQueue(args: {
  sessionId: string
  queueItemIds: string[]
}): Promise<ChatQueueListResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueItemIds: args.queueItemIds }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to reorder chat queue: ${res.status} ${body}`)
  }

  return parseChatQueueListResponse(await res.json())
}

export async function cancelChatResponse(sessionId: string): Promise<void> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/cancel`, {
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to cancel chat response: ${res.status} ${body}`)
  }
}

export async function submitRuntimeUserInput(args: {
  sessionId: string
  requestId: string
  answers: Record<string, string[]>
  signal?: AbortSignal
}): Promise<{ requestId: string, answers: Record<string, string[]> }> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/user-input/${args.requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: args.answers }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to submit runtime user input: ${res.status} ${body}`)
  }

  return await res.json() as { requestId: string, answers: Record<string, string[]> }
}

export async function submitRuntimeToolApproval(args: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
  signal?: AbortSignal
}): Promise<{ requestId: string, approved: boolean, reason?: string }> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/tool-approval/${args.requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      approved: args.approved,
      ...(args.reason ? { reason: args.reason } : {}),
    }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to submit runtime tool approval: ${res.status} ${body}`)
  }

  return await res.json() as { requestId: string, approved: boolean, reason?: string }
}

export async function resolvePlanImplementationApproval(args: {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
  signal?: AbortSignal
}): Promise<PlanImplementationApprovalResult> {
  const sessionId = encodeURIComponent(args.sessionId)
  const messageId = encodeURIComponent(args.messageId)
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/messages/${messageId}/plan-implementation-approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      approvalId: args.approvalId,
      approved: args.approved,
    }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to resolve plan implementation approval: ${res.status} ${body}`)
  }

  return parsePlanImplementationApprovalResponse(await res.json())
}
