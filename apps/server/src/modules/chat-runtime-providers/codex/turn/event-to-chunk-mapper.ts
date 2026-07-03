/**
 * Output: AI SDK UIMessageChunk events projected from Codex app-server notifications.
 * Input: Codex app-server item lifecycle, delta, patch, and server request notifications.
 * Position: Codex provider package event mapper between app-server protocol and Chat Runtime chunks.
 */

import type { UIMessageChunk } from 'ai'

import type { BoundedTextCollector } from '../../bounded-text-collector'
import { createBoundedTextCollector } from '../../bounded-text-collector'
import { providerChunk } from '../../kit/chunk-mapper'
import { isCodexAppServerToolApprovalRequest } from '../app-server/server-request-methods'
import type { ResponseItem as CodexResponseItem } from '../app-server-protocol/ResponseItem'
import type { CodexAppServerItem } from '../tools/mapper'
import {
  buildCodexServerRequestToolInput,
  buildCodexServerRequestToolOutput,
  buildCodexToolInput,
  buildCodexToolOutput,
  projectCodexFileChangePatch,
  readCodexToolError,
  readCodexToolName,
} from '../tools/mapper'

export interface CodexAppServerMapperState {
  openReasoningItemIds: Set<string>
  emittedReasoningTextLengthById: Map<string, number>
  emittedTextLengthById: Map<string, number>
  commandOutputById: Map<string, BoundedTextCollector>
  commandById: Map<string, string>
  toolArgsById: Map<string, unknown>
  startedToolItemIds: Set<string>
  startedAgentMessageIds: Set<string>
  pendingServerRequestIds: Set<number>
  emittedImageFileItemIds: Set<string>
  synthesizePlanImplementationRequest: boolean
  lastCompletedPlan: CodexCompletedPlan | null
  emittedPlanImplementationTurnIds: Set<string>
}

export interface CodexAppServerNotification {
  method?: string
  params?: unknown
}

interface ItemNotificationParams {
  item?: CodexAppServerItem
  threadId?: string
  turnId?: string
}

interface DeltaNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  delta?: string
}

interface RawResponseItemCompletedParams {
  threadId?: string
  turnId?: string
  item?: CodexResponseItem
}

interface ServerRequestHandledParams {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
}

interface ServerRequestPendingParams {
  id?: number
  method?: string
  params?: unknown
}

interface TurnCompletedParams {
  turn?: {
    id?: string
    status?: string
  }
}

interface TurnModerationMetadataParams {
  threadId?: string
  turnId?: string
  metadata?: unknown
}

interface CodexCompletedPlan {
  turnId: string
  content: string
}

type CommandExecutionArgs = Pick<
  CodexAppServerItem,
  'command' | 'cwd' | 'processId' | 'source' | 'status' | 'commandActions'
>

export function createCodexAppServerMapperState(
  textItemId: string,
  options: { synthesizePlanImplementationRequest?: boolean } = {},
): CodexAppServerMapperState {
  void textItemId
  return {
    openReasoningItemIds: new Set(),
    emittedReasoningTextLengthById: new Map(),
    emittedTextLengthById: new Map(),
    commandOutputById: new Map(),
    commandById: new Map(),
    toolArgsById: new Map(),
    startedToolItemIds: new Set(),
    startedAgentMessageIds: new Set(),
    pendingServerRequestIds: new Set(),
    emittedImageFileItemIds: new Set(),
    synthesizePlanImplementationRequest: options.synthesizePlanImplementationRequest === true,
    lastCompletedPlan: null,
    emittedPlanImplementationTurnIds: new Set(),
  }
}

export function mapCodexAppServerNotificationToChunks(
  notification: CodexAppServerNotification,
  state: CodexAppServerMapperState,
): UIMessageChunk[] {
  switch (notification.method) {
    case 'item/started':
      return mapStartedItem(notification.params, state)
    case 'item/completed':
      return mapCompletedItem(notification.params, state)
    case 'rawResponseItem/completed':
      return mapRawResponseItemCompleted(notification.params, state)
    case 'turn/completed':
      return mapCompletedTurn(notification.params, state)
    case 'turn/moderationMetadata':
      return mapTurnModerationMetadata(notification.params)
    case 'item/agentMessage/delta':
      return mapAgentMessageDelta(notification.params, state)
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta':
      return mapReasoningDelta(notification.params, state)
    case 'command/exec/outputDelta':
    case 'item/commandExecution/outputDelta':
      return mapCommandOutputDelta(notification.params, state)
    case 'item/fileChange/outputDelta':
      return mapToolProgressDelta(notification.params, state, 'fileChange')
    case 'item/plan/delta':
      return mapToolProgressDelta(notification.params, state, 'plan')
    case 'item/mcpToolCall/progress':
      return mapToolProgressDelta(notification.params, state, 'mcpToolCall')
    case 'item/fileChange/patchUpdated':
      return mapFileChangePatchUpdated(notification.params)
    case 'serverRequest/pending':
      return mapPendingServerRequest(notification.params, state)
    case 'serverRequest/handled':
      return mapHandledServerRequest(notification.params, state)
    default:
      return []
  }
}

export function closeOpenCodexAppServerReasoning(state: CodexAppServerMapperState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  for (const itemId of state.openReasoningItemIds) {
    chunks.push(providerChunk.reasoningEnd(itemId))
  }
  state.openReasoningItemIds.clear()
  return chunks
}

export function closeOpenCodexAppServerText(state: CodexAppServerMapperState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  for (const itemId of state.startedAgentMessageIds) {
    chunks.push(providerChunk.textEnd(itemId))
  }
  state.startedAgentMessageIds.clear()
  return chunks
}

function mapStartedItem(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as ItemNotificationParams
  const item = params.item ?? null
  if (!item) {
    return []
  }
  switch (item.type) {
    case 'agentMessage':
      return mapAgentMessageSnapshot(item, state, params)
    case 'reasoning':
      return mapReasoningSnapshot(item, state, false)
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'subAgentActivity':
    case 'webSearch':
    case 'sleep':
    case 'plan':
    case 'imageView':
    case 'imageGeneration':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
    case 'contextCompaction':
      return mapStartedToolItem(item, state)
    default:
      return []
  }
}

function mapStartedToolItem(item: CodexAppServerItem, state: CodexAppServerMapperState): UIMessageChunk[] {
  const toolName = toSafeToolName(readCodexToolName(item))
  const input = buildCodexToolInput(item)
  if (item.type === 'commandExecution') {
    state.commandById.set(item.id, item.command ?? '')
  }
  state.toolArgsById.set(item.id, input.args)
  if (state.startedToolItemIds.has(item.id)) {
    return [
      ...closeOpenAgentMessageSegments(state),
      providerChunk.toolInputAvailable({ toolCallId: item.id, toolName, input }),
    ]
  }
  state.startedToolItemIds.add(item.id)
  return [
    ...closeOpenAgentMessageSegments(state),
    providerChunk.toolInputStart(item.id, toolName),
    providerChunk.toolInputAvailable({ toolCallId: item.id, toolName, input }),
  ]
}

function mapCompletedItem(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as ItemNotificationParams
  const item = params.item ?? null
  if (!item) {
    return []
  }
  switch (item.type) {
    case 'agentMessage':
      return mapAgentMessageSnapshot(item, state, params)
    case 'reasoning':
      return mapReasoningSnapshot(item, state, true)
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'subAgentActivity':
    case 'webSearch':
    case 'sleep':
    case 'plan':
    case 'imageView':
    case 'imageGeneration':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
    case 'contextCompaction':
      recordCompletedPlan(item, params.turnId, state)
      return mapCompletedToolItem(item, state)
    default:
      return []
  }
}

function recordCompletedPlan(
  item: CodexAppServerItem,
  turnId: string | undefined,
  state: CodexAppServerMapperState,
): void {
  if (item.type !== 'plan' || !turnId) {
    return
  }
  const content = item.text?.trim()
  if (!content) {
    return
  }
  state.lastCompletedPlan = { turnId, content }
}

function mapCompletedTurn(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  if (!state.synthesizePlanImplementationRequest) {
    return []
  }
  const params = rawParams as TurnCompletedParams
  const turn = params.turn
  const turnId = turn?.id
  if (!turnId || turn.status !== 'completed') {
    return []
  }
  const plan = state.lastCompletedPlan
  if (!plan || plan.turnId !== turnId || state.emittedPlanImplementationTurnIds.has(turnId)) {
    return []
  }
  state.emittedPlanImplementationTurnIds.add(turnId)
  state.lastCompletedPlan = null

  const toolCallId = `implement-plan:${turnId}`
  const item: CodexAppServerItem = {
    id: toolCallId,
    type: 'planImplementation',
    turnId,
    planContent: plan.content,
  }
  state.startedToolItemIds.add(toolCallId)
  state.toolArgsById.set(toolCallId, buildCodexToolInput(item).args)
  const toolName = readCodexToolName(item)

  return [
    ...closeOpenAgentMessageSegments(state),
    providerChunk.toolInputStart(toolCallId, toolName),
    providerChunk.toolInputAvailable({ toolCallId, toolName, input: buildCodexToolInput(item) }),
    providerChunk.toolApprovalRequest(toolCallId),
  ]
}

function mapCompletedToolItem(item: CodexAppServerItem, state: CodexAppServerMapperState): UIMessageChunk[] {
  const errorText = readCodexToolError(item)
  if (errorText) {
    return [providerChunk.toolOutputError(item.id, errorText)]
  }
  const chunks: UIMessageChunk[] = [providerChunk.toolOutputAvailable({
    toolCallId: item.id,
    output: buildCodexToolOutput(
      item,
      state.commandOutputById.get(item.id)?.read(),
      state.commandById.get(item.id),
      state.toolArgsById.get(item.id),
    ),
  })]
  const imageChunk = projectCodexImageFileChunk(item)
  if (imageChunk && !state.emittedImageFileItemIds.has(item.id)) {
    state.emittedImageFileItemIds.add(item.id)
    chunks.push(imageChunk)
  }
  return chunks
}

function projectCodexImageFileChunk(item: CodexAppServerItem): UIMessageChunk | null {
  switch (item.type) {
    case 'imageGeneration':
      return projectCodexImageGenerationFileChunk(item)
    case 'imageView':
      return projectCodexImageViewFileChunk(item)
    default:
      return null
  }
}

function projectCodexImageGenerationFileChunk(item: CodexAppServerItem): UIMessageChunk | null {
  const savedPath = (item as { savedPath?: string | null }).savedPath
  if (savedPath) {
    return providerChunk.file({ mediaType: 'image/*', url: `file://${savedPath}` })
  }
  const result = (item as { result?: string | null }).result
  return projectImageResultStringFileChunk(result)
}

function projectCodexImageViewFileChunk(item: CodexAppServerItem): UIMessageChunk | null {
  const path = (item as { path?: string | null }).path
  return path ? providerChunk.file({ mediaType: 'image/*', url: `file://${path}` }) : null
}

function readImageDataUrlMediaType(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value)
  return match?.[1] ?? null
}

function projectImageResultStringFileChunk(value: string | null | undefined): UIMessageChunk | null {
  if (!value) {
    return null
  }
  const mediaType = readImageDataUrlMediaType(value)
  if (mediaType) {
    return providerChunk.file({ mediaType, url: value })
  }
  if (/^https?:\/\//i.test(value)) {
    return providerChunk.file({ mediaType: 'image/*', url: value })
  }
  return providerChunk.file({ mediaType: 'image/png', url: `data:image/png;base64,${value}` })
}

function mapAgentMessageDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.delta || !params.itemId) {
    return []
  }
  state.emittedTextLengthById.set(
    params.itemId,
    (state.emittedTextLengthById.get(params.itemId) ?? 0) + params.delta.length,
  )
  const chunks: UIMessageChunk[] = []
  if (!state.startedAgentMessageIds.has(params.itemId)) {
    state.startedAgentMessageIds.add(params.itemId)
    chunks.push(providerChunk.textStart(params.itemId))
  }
  chunks.push(providerChunk.textDelta(params.itemId, params.delta))
  return chunks
}

function mapRawResponseItemCompleted(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as RawResponseItemCompletedParams
  if (!params.threadId || !params.turnId || params.item === undefined) {
    return []
  }
  const chunks: UIMessageChunk[] = [{
    type: 'message-metadata',
    messageMetadata: {
      codex: {
        responseItems: [{
          threadId: params.threadId,
          turnId: params.turnId,
          item: params.item,
        }],
      },
    },
  }]
  const item = params.item
  if (item.type === 'image_generation_call' && (!item.id || !state.emittedImageFileItemIds.has(item.id))) {
    const imageChunk = projectImageResultStringFileChunk(item.result)
    if (imageChunk) {
      if (item.id) {
        state.emittedImageFileItemIds.add(item.id)
      }
      chunks.push(imageChunk)
    }
  }
  return chunks
}

function mapTurnModerationMetadata(rawParams: unknown): UIMessageChunk[] {
  const params = rawParams as TurnModerationMetadataParams
  if (!params.turnId) {
    return []
  }
  return [{
    type: 'message-metadata',
    messageMetadata: {
      codex: {
        moderationMetadataByTurnId: {
          [params.turnId]: {
            threadId: params.threadId ?? null,
            turnId: params.turnId,
            metadata: params.metadata,
          },
        },
      },
    },
  }]
}

function mapReasoningDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.itemId || !params.delta) {
    return []
  }
  const chunks: UIMessageChunk[] = []
  if (!state.openReasoningItemIds.has(params.itemId)) {
    state.openReasoningItemIds.add(params.itemId)
    chunks.push(providerChunk.reasoningStart(params.itemId))
  }
  state.emittedReasoningTextLengthById.set(
    params.itemId,
    (state.emittedReasoningTextLengthById.get(params.itemId) ?? 0) + params.delta.length,
  )
  chunks.push(providerChunk.reasoningDelta(params.itemId, params.delta))
  return chunks
}

function mapCommandOutputDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.itemId || !params.delta) {
    return []
  }
  const collector = state.commandOutputById.get(params.itemId) ?? createBoundedTextCollector()
  collector.append(params.delta)
  state.commandOutputById.set(params.itemId, collector)
  return [
    ...startToolItemForOutOfOrderDelta(state, {
      id: params.itemId,
      type: 'commandExecution',
    }),
    providerChunk.toolOutputAvailable({
      toolCallId: params.itemId,
      preliminary: true,
      output: buildCodexToolOutput(
        readBufferedCommandExecutionItem(params.itemId, state),
        collector.read(),
        state.commandById.get(params.itemId),
        state.toolArgsById.get(params.itemId),
      ),
    }),
  ]
}

function readBufferedCommandExecutionItem(
  itemId: string,
  state: CodexAppServerMapperState,
): CodexAppServerItem {
  const args = state.toolArgsById.get(itemId) as Partial<CommandExecutionArgs> | undefined
  return {
    id: itemId,
    type: 'commandExecution',
    command: args?.command ?? state.commandById.get(itemId),
    cwd: args?.cwd,
    processId: args?.processId,
    source: args?.source,
    status: args?.status ?? 'inProgress',
    commandActions: args?.commandActions,
  }
}

function mapToolProgressDelta(
  rawParams: unknown,
  state: CodexAppServerMapperState,
  itemType: 'fileChange' | 'mcpToolCall' | 'plan',
): UIMessageChunk[] {
  const params = rawParams as { itemId?: string, delta?: string, message?: string }
  const delta = params.delta ?? params.message
  if (!params.itemId || !delta) {
    return []
  }
  return [
    ...startToolItemForOutOfOrderDelta(state, {
      id: params.itemId,
      type: itemType,
    }),
    providerChunk.toolInputDelta(params.itemId, delta),
  ]
}

function startToolItemForOutOfOrderDelta(
  state: CodexAppServerMapperState,
  item: CodexAppServerItem,
): UIMessageChunk[] {
  if (state.startedToolItemIds.has(item.id)) {
    return []
  }

  const toolName = toSafeToolName(readCodexToolName(item))
  const input = buildCodexToolInput(item)
  state.startedToolItemIds.add(item.id)
  state.toolArgsById.set(item.id, input.args)
  if (item.type === 'commandExecution') {
    state.commandById.set(item.id, item.command ?? '')
  }

  // Codex app-server progress/output notifications can arrive before the
  // matching item/started notification during reconnects or live event
  // fan-out. AI SDK rejects tool-input-delta without a prior tool-input-start,
  // so emit the smallest valid placeholder and let item/started publish the
  // authoritative input later via tool-input-available.
  return [
    ...closeOpenAgentMessageSegments(state),
    providerChunk.toolInputStart(item.id, toolName),
  ]
}

function mapFileChangePatchUpdated(rawParams: unknown): UIMessageChunk[] {
  const params = rawParams as {
    itemId?: string
    changes?: Array<{ path: string, diff?: string | null, kind?: unknown }>
  }
  if (!params.itemId) {
    return []
  }
  const changes = params.changes ?? []
  return [providerChunk.toolOutputAvailable({
    toolCallId: params.itemId,
    preliminary: true,
    output: {
      type: 'cradle.codex.file-change.patch-updated.v1',
      ...projectCodexFileChangePatch(changes),
      changes,
    },
  })]
}

function mapPendingServerRequest(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as ServerRequestPendingParams
  if (typeof params.id !== 'number' || !params.method) {
    return []
  }
  state.pendingServerRequestIds.add(params.id)
  const request = { id: params.id, method: params.method, params: params.params }
  const toolCallId = `server-request-${params.id}`
  const toolName = toSafeToolName(`server_request_${params.method}`)
  const chunks: UIMessageChunk[] = [
    providerChunk.toolInputStart(toolCallId, toolName),
    providerChunk.toolInputAvailable({
      toolCallId,
      toolName,
      input: buildCodexServerRequestToolInput(request),
    }),
  ]
  if (isCodexAppServerToolApprovalRequest(params.method)) {
    chunks.push(providerChunk.toolApprovalRequest(toolCallId))
  }
  return chunks
}

function mapHandledServerRequest(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as ServerRequestHandledParams
  if (typeof params.id !== 'number' || !params.method) {
    return []
  }
  const request = { id: params.id, method: params.method, params: params.params }
  const toolCallId = `server-request-${params.id}`
  const toolName = toSafeToolName(`server_request_${params.method}`)
  if (state.pendingServerRequestIds.delete(params.id)) {
    return [providerChunk.toolOutputAvailable({
      toolCallId,
      output: buildCodexServerRequestToolOutput(request, params.result),
    })]
  }
  return [
    providerChunk.toolInputStart(toolCallId, toolName),
    providerChunk.toolInputAvailable({
      toolCallId,
      toolName,
      input: buildCodexServerRequestToolInput(request),
    }),
    providerChunk.toolOutputAvailable({
      toolCallId,
      output: buildCodexServerRequestToolOutput(request, params.result),
    }),
  ]
}

function toSafeToolName(value: string): string {
  return value.replace(/[^\w-]/g, '_')
}

function mapAgentMessageSnapshot(
  item: CodexAppServerItem,
  state: CodexAppServerMapperState,
  params: ItemNotificationParams,
): UIMessageChunk[] {
  const text = item.text ?? ''
  const previousTextLength = state.emittedTextLengthById.get(item.id) ?? 0
  if (text.length <= previousTextLength) {
    if (state.startedAgentMessageIds.delete(item.id)) {
      return [providerChunk.textEnd(item.id)]
    }
    return []
  }
  const chunks = mapAgentMessageDelta({
    itemId: item.id,
    threadId: params.threadId,
    turnId: params.turnId,
    delta: text.slice(previousTextLength),
  }, state)
  state.startedAgentMessageIds.delete(item.id)
  chunks.push(providerChunk.textEnd(item.id))
  return chunks
}

function mapReasoningSnapshot(
  item: CodexAppServerItem,
  state: CodexAppServerMapperState,
  complete: boolean,
): UIMessageChunk[] {
  const text = mapReasoningSnapshotText(item).join('')
  const previousTextLength = state.emittedReasoningTextLengthById.get(item.id) ?? 0
  const chunks: UIMessageChunk[] = []

  if (text.length > previousTextLength) {
    if (!state.openReasoningItemIds.has(item.id)) {
      state.openReasoningItemIds.add(item.id)
      chunks.push(providerChunk.reasoningStart(item.id))
    }
    const delta = text.slice(previousTextLength)
    state.emittedReasoningTextLengthById.set(item.id, text.length)
    chunks.push(providerChunk.reasoningDelta(item.id, delta))
  }

  if (complete && state.openReasoningItemIds.has(item.id)) {
    state.openReasoningItemIds.delete(item.id)
    chunks.push(providerChunk.reasoningEnd(item.id))
  }

  return chunks
}

function mapReasoningSnapshotText(item: CodexAppServerItem): string[] {
  if (item.content?.length) {
    return item.content
  }
  if (item.summary?.length) {
    return item.summary
  }
  return []
}

function closeOpenAgentMessageSegments(state: CodexAppServerMapperState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  for (const itemId of state.startedAgentMessageIds) {
    chunks.push(providerChunk.textEnd(itemId))
  }
  state.startedAgentMessageIds.clear()
  return chunks
}
