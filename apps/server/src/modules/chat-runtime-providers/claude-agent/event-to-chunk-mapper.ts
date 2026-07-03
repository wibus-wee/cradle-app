/**
 * Output: AI SDK UIMessageChunk events projected from Claude Agent SDK messages.
 * Input: Claude Agent SDK stream messages, tool-use snapshots, result messages, and subagent parent tool ids.
 * Position: Claude Agent provider package event mapper between SDK-native events and Chat Runtime chunks.
 */

import { randomUUID } from 'node:crypto'

import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { providerChunk } from '../kit/chunk-mapper'
import { CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE, isClaudeAgentEnterPlanModeToolName, isClaudeAgentExitPlanModeToolName } from './plan-mode'
import { ClaudeCodeToolName } from './tools/identity'
import { createClaudeCodeToolInputPayload, createClaudeCodeToolResultPayload, normalizeClaudeCodeToolApiName } from './tools/mapper'
import type { ClaudeAgentTaskProgressState } from './tools/task-progress-state'
import {
  captureClaudeAgentTaskToolInput,
  captureClaudeAgentTaskToolResult,
  createClaudeAgentTaskProgressState,
} from './tools/task-progress-state'
import type { TodoPluginItem } from './tools/todo-plugin-state'
import { isTodoWriteToolName, synthesizeTodoWritePluginState } from './tools/todo-plugin-state'

const PLAN_IMPLEMENTATION_TOOL_NAME = 'plan_implementation'
const CLAUDE_PLAN_FILE_PATH_SEGMENT = '/.claude/plans/'

interface BetaContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
}

interface BetaRawContentBlockDeltaEvent {
  type: 'content_block_delta'
  index: number
  delta: {
    type: string
    text?: string
    thinking?: string
    partial_json?: string
  }
}

interface BetaRawContentBlockStartEvent {
  type: 'content_block_start'
  index: number
  content_block: BetaContentBlock
}

interface BetaRawMessageDeltaEvent {
  type: 'message_delta'
  delta?: {
    stop_reason?: string | null
  }
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export interface ClaudeAgentChunkMapperState {
  textItemId: string
  assistantStarted: boolean
  /** True when tool calls have been emitted since last text segment — next text gets a fresh ID */
  hadToolCallSinceLastText: boolean
  /** Tracks emitted text per text segment so full assistant snapshots do not replay streamed text. */
  emittedTextByTextItemId: Map<string, TextAccumulator>
  /** Tracks emitted tool lifecycle fragments so full assistant snapshots do not replay streamed tool blocks. */
  emittedToolStateByToolCallId: Map<string, { started: boolean, inputAvailable: boolean, outputAvailable?: boolean, approvalRequested?: boolean, interactionModeCaptured?: boolean }>
  /** Maps content block index → tool_use block ID for streaming tool input deltas */
  activeToolBlockIds: Map<number, string>
  /** Tracks tool names by call ID so result messages can read adapter-owned semantics. */
  toolNamesByToolCallId: Map<string, string>
  /** Accumulates streaming JSON input for tool_use blocks until a full snapshot arrives. */
  toolInputTextByToolCallId: Map<string, TextAccumulator>
  /** Caches Cradle-owned tool args by tool call so results can carry a stable tool envelope. */
  toolArgsByToolCallId: Map<string, unknown>
  /** Tracks structured Claude TaskCreate/TaskUpdate state for progress slot projection. */
  taskProgress: ClaudeAgentTaskProgressState
  /** Maps content block index → text item ID for currently-streaming text blocks. */
  activeTextBlockByIndex: Map<number, string>
  /** Maps content block index → reasoning item ID for currently-streaming thinking blocks. */
  activeThinkingBlockByIndex: Map<number, string>
  /** Content block indices whose text blocks were fully emitted via stream events (text-end sent). */
  completedTextBlockIndices: Set<number>
  /** Content block indices whose thinking blocks were fully emitted via stream events (reasoning-end sent). */
  completedThinkingBlockIndices: Set<number>
  /** Tool call IDs whose ExitPlanMode signal was captured by Cradle. */
  capturedExitPlanToolCallIds: Set<string>
  /** Latest plan body written through Claude plan mode before ExitPlanMode. */
  latestPlanFileContent: string | null
}

interface TextAccumulator {
  parts: string[]
  length: number
}

export interface ClaudeAgentCapturedPlan {
  toolCallId: string
  content: string
}

export interface ClaudeAgentCapturedTodos {
  toolCallId: string
  todos: TodoPluginItem[]
  source?: string
}

export interface ClaudeAgentCapturedInteractionMode {
  toolCallId: string
  interactionMode: 'plan'
}

export interface ClaudeAgentCapturedCrewCall {
  toolCallId: string
  tool: string
  agentId: string | null
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

export interface ClaudeAgentChunkMapperResult {
  chunks: UIMessageChunk[]
  sessionId: string | null
  usage: TokenUsage | null
  capturedPlans: ClaudeAgentCapturedPlan[]
  capturedTodos: ClaudeAgentCapturedTodos[]
  capturedInteractionModes: ClaudeAgentCapturedInteractionMode[]
  capturedCrewCalls: ClaudeAgentCapturedCrewCall[]
}

export async function mapClaudeAgentMessageToChunks(msg: SDKMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  normalizeClaudeAgentChunkMapperState(state)
  return mapClaudeAgentMessageToChunksWithoutParentProjection(msg, state)
}

function normalizeClaudeAgentChunkMapperState(state: ClaudeAgentChunkMapperState): void {
  state.emittedTextByTextItemId ??= new Map()
  state.emittedToolStateByToolCallId ??= new Map()
  state.activeToolBlockIds ??= new Map()
  state.toolNamesByToolCallId ??= new Map()
  state.toolInputTextByToolCallId ??= new Map()
  state.toolArgsByToolCallId ??= new Map()
  state.taskProgress ??= createClaudeAgentTaskProgressState()
  state.activeTextBlockByIndex ??= new Map()
  state.activeThinkingBlockByIndex ??= new Map()
  state.completedTextBlockIndices ??= new Set()
  state.completedThinkingBlockIndices ??= new Set()
  state.capturedExitPlanToolCallIds ??= new Set()
  state.latestPlanFileContent ??= null
}

export function createClaudeAgentChunkMapperState(textItemId: string = randomUUID()): ClaudeAgentChunkMapperState {
  return {
    textItemId,
    assistantStarted: false,
    hadToolCallSinceLastText: false,
    emittedTextByTextItemId: new Map(),
    emittedToolStateByToolCallId: new Map(),
    activeToolBlockIds: new Map(),
    toolNamesByToolCallId: new Map(),
    toolInputTextByToolCallId: new Map(),
    toolArgsByToolCallId: new Map(),
    taskProgress: createClaudeAgentTaskProgressState(),
    activeTextBlockByIndex: new Map(),
    activeThinkingBlockByIndex: new Map(),
    completedTextBlockIndices: new Set(),
    completedThinkingBlockIndices: new Set(),
    capturedExitPlanToolCallIds: new Set(),
    latestPlanFileContent: null,
  }
}

export function resetClaudeAgentChunkMapperForTurn(state: ClaudeAgentChunkMapperState, textItemId: string = randomUUID()): void {
  state.textItemId = textItemId
  state.assistantStarted = false
  state.hadToolCallSinceLastText = false
  state.emittedTextByTextItemId.clear()
  state.emittedToolStateByToolCallId.clear()
  state.activeToolBlockIds.clear()
  state.toolInputTextByToolCallId.clear()
  state.taskProgress = createClaudeAgentTaskProgressState()
  state.activeTextBlockByIndex.clear()
  state.activeThinkingBlockByIndex.clear()
  state.completedTextBlockIndices.clear()
  state.completedThinkingBlockIndices.clear()
  state.capturedExitPlanToolCallIds.clear()
  state.latestPlanFileContent = null
}

export async function mapClaudeAgentMessageToChunksWithoutParentProjection(msg: SDKMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  const base: ClaudeAgentChunkMapperResult = {
    chunks: [],
    sessionId: null,
    usage: null,
    capturedPlans: [],
    capturedTodos: [],
    capturedInteractionModes: [],
    capturedCrewCalls: [],
  }

  switch (msg.type) {
    case 'assistant':
      return mapAssistant(msg, state)
    case 'user':
      return mapUser(msg as SDKUserMessage, state)
    case 'stream_event':
      return mapStreamEvent(msg, state)
    case 'result':
      return mapResult(msg, state)
    default:
      return mapSystemOrUnknown(msg, state, base)
  }
}

/**
 * Handle system lifecycle events (task_started, task_progress, task_notification, tool_progress, etc.)
 */
function mapSystemOrUnknown(msg: SDKMessage, state: ClaudeAgentChunkMapperState, base: ClaudeAgentChunkMapperResult): ClaudeAgentChunkMapperResult {
  // Extract session_id from any message that carries it
  const sessionId = 'session_id' in msg && typeof (msg as { session_id?: unknown }).session_id === 'string'
    ? (msg as { session_id: string }).session_id
    : null

  const systemEvent = readClaudeSystemLifecycleEvent(msg)
  const chunks: UIMessageChunk[] = []

  // Handle task lifecycle events — emit as step markers with metadata
  if (systemEvent?.subtype === 'task_started') {
    const taskMsg = systemEvent.message
    chunks.push({
      type: 'start-step',
    })
    // Emit a text segment to announce the subagent
    const agentName = taskMsg.subagent_type ?? taskMsg.workflow_name ?? taskMsg.description ?? 'Subagent'
    const textId = randomUUID()
    base.capturedCrewCalls.push({
      toolCallId: taskMsg.tool_use_id ?? taskMsg.task_id,
      tool: taskMsg.task_type === 'local_workflow' ? ClaudeCodeToolName.Workflow : ClaudeCodeToolName.Agent,
      agentId: taskMsg.task_id,
      prompt: taskMsg.prompt ?? null,
      description: taskMsg.description ?? null,
      subagentType: taskMsg.subagent_type ?? taskMsg.workflow_name ?? null,
      model: null,
      reasoningEffort: null,
      tools: [],
      outputFile: null,
      runInBackground: true,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
    })
    chunks.push(
      providerChunk.textStart(textId, { cradle: { systemEvent: 'task_started', taskId: taskMsg.task_id, agentName } }),
      providerChunk.textDelta(textId, `[${agentName} started]`),
      providerChunk.textEnd(textId),
    )
  }
  else if (systemEvent?.subtype === 'task_progress') {
    const taskMsg = systemEvent.message
    base.capturedCrewCalls.push({
      toolCallId: taskMsg.tool_use_id ?? taskMsg.task_id,
      tool: ClaudeCodeToolName.Agent,
      agentId: taskMsg.task_id,
      prompt: null,
      description: taskMsg.description ?? taskMsg.summary ?? null,
      subagentType: taskMsg.subagent_type ?? null,
      model: null,
      reasoningEffort: null,
      tools: [],
      outputFile: null,
      runInBackground: true,
      status: 'running',
      startedAt: 0,
      completedAt: null,
    })
  }
  else if (systemEvent?.subtype === 'task_notification') {
    const taskMsg = systemEvent.message
    const textId = randomUUID()
    const status = taskMsg.status
    base.capturedCrewCalls.push({
      toolCallId: taskMsg.tool_use_id ?? taskMsg.task_id,
      tool: ClaudeCodeToolName.Agent,
      agentId: taskMsg.task_id,
      prompt: null,
      description: taskMsg.summary ?? null,
      subagentType: null,
      model: null,
      reasoningEffort: null,
      tools: [],
      outputFile: taskMsg.output_file ?? null,
      runInBackground: true,
      status: status === 'completed' ? 'completed' : 'failed',
      startedAt: 0,
      completedAt: Date.now(),
    })
    chunks.push(
      providerChunk.textStart(textId, { cradle: { systemEvent: 'task_notification', taskId: taskMsg.task_id, status } }),
      providerChunk.textDelta(textId, taskMsg.summary || `[Task ${status}]`),
      providerChunk.textEnd(textId),
      { type: 'finish-step' },
    )
  }
  else if (msg.type === 'tool_progress') {
    const progressMsg = msg as { type: string, tool_use_id?: string, tool_name?: string, content?: string, parent_tool_use_id?: string | null }
    if (progressMsg.content && progressMsg.tool_use_id) {
      chunks.push(providerChunk.toolInputDelta(progressMsg.tool_use_id, progressMsg.content))
    }
  }

  return { ...base, chunks, sessionId }
}

type ClaudeSystemLifecycleEvent
  = | { subtype: 'task_started', message: SDKTaskStartedMessage }
    | { subtype: 'task_progress', message: SDKTaskProgressMessage }
    | { subtype: 'task_notification', message: SDKTaskNotificationMessage }

function readClaudeSystemLifecycleEvent(message: SDKMessage): ClaudeSystemLifecycleEvent | null {
  if (message.type !== 'system') {
    return null
  }
  switch (message.subtype) {
    case 'task_started':
      return { subtype: 'task_started', message }
    case 'task_progress':
      return { subtype: 'task_progress', message }
    case 'task_notification':
      return { subtype: 'task_notification', message }
    default:
      return null
  }
}

function mapAssistant(msg: SDKAssistantMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  const capturedPlans: ClaudeAgentCapturedPlan[] = []
  const capturedTodos: ClaudeAgentCapturedTodos[] = []
  const capturedInteractionModes: ClaudeAgentCapturedInteractionMode[] = []
  const capturedCrewCalls: ClaudeAgentCapturedCrewCall[] = []

  const flushTextSegment = (text: string) => {
    if (text.length === 0) {
      return
    }
    const result = emitAssistantTextSegment(text, state)
    chunks.push(...result.chunks)
  }

  let pendingText = ''
  for (let blockIndex = 0; blockIndex < msg.message.content.length; blockIndex++) {
    const block = msg.message.content[blockIndex]!
    if (block.type === 'text') {
      if (
        state.activeTextBlockByIndex.has(blockIndex)
        || state.completedTextBlockIndices.has(blockIndex)
      ) {
        continue
      }
      pendingText += block.text
      continue
    }

    flushTextSegment(pendingText)
    pendingText = ''

    if (block.type === 'tool_use') {
      const mapped = mapContentBlock(block, state)
      chunks.push(...mapped.chunks)
      capturedPlans.push(...mapped.capturedPlans)
      capturedTodos.push(...mapped.capturedTodos)
      capturedInteractionModes.push(...mapped.capturedInteractionModes)
      capturedCrewCalls.push(...mapped.capturedCrewCalls)
      state.hadToolCallSinceLastText = true
      continue
    }

    // Skip thinking blocks that were fully handled by stream events — they already
    // emitted reasoning-start/delta/end, and the snapshot would create a duplicate part.
    if (
      block.type === 'thinking'
      && (
        state.activeThinkingBlockByIndex.has(blockIndex)
        || state.completedThinkingBlockIndices.has(blockIndex)
      )
    ) {
      continue
    }

    const mapped = mapContentBlock(block, state)
    chunks.push(...mapped.chunks)
    capturedPlans.push(...mapped.capturedPlans)
    capturedTodos.push(...mapped.capturedTodos)
    capturedInteractionModes.push(...mapped.capturedInteractionModes)
    capturedCrewCalls.push(...mapped.capturedCrewCalls)
  }
  flushTextSegment(pendingText)

  const usage = msg.message.usage
    ? {
        promptTokens: msg.message.usage.input_tokens ?? 0,
        completionTokens: msg.message.usage.output_tokens ?? 0,
        totalTokens: (msg.message.usage.input_tokens ?? 0) + (msg.message.usage.output_tokens ?? 0),
      }
    : null

  return { chunks, sessionId: msg.session_id, usage, capturedPlans, capturedTodos, capturedInteractionModes, capturedCrewCalls }
}

async function mapUser(msg: SDKUserMessage, state: ClaudeAgentChunkMapperState): Promise<ClaudeAgentChunkMapperResult> {
  clearCompletedAssistantBlockIndices(state)

  const chunks: UIMessageChunk[] = []
  const capturedTodos: ClaudeAgentCapturedTodos[] = []
  const capturedCrewCalls: ClaudeAgentCapturedCrewCall[] = []
  const content = msg.message.content

  // Extract tool_result blocks from user message content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'type' in block) {
        const b = block as { type: string, tool_use_id?: string, content?: unknown, is_error?: boolean }
        if (b.type === 'tool_result' && b.tool_use_id) {
          const normalizedOutput = normalizeToolResultContent(readToolResultContent(msg, b))

          // Capture Agent tool result as crew call completion
          const toolName = state.toolNamesByToolCallId.get(b.tool_use_id)
          const normalizedToolName = toolName ? normalizeClaudeCodeToolApiName(toolName) : null
          if (normalizedToolName === ClaudeCodeToolName.Agent || normalizedToolName === ClaudeCodeToolName.Workflow) {
            const launch = readClaudeAgentAsyncLaunchResult(normalizedOutput)
            const status = b.is_error
              ? 'failed'
              : launch?.status === 'async_launched'
                ? 'running'
                : 'completed'
            capturedCrewCalls.push({
              toolCallId: b.tool_use_id,
              tool: normalizedToolName,
              agentId: launch?.agentId ?? null,
              prompt: null,
              description: null,
              subagentType: null,
              model: null,
              reasoningEffort: null,
              tools: [],
              outputFile: launch?.outputFile ?? null,
              runInBackground: false,
              status,
              startedAt: 0,
              completedAt: status === 'running' ? null : Date.now(),
            })
          }

          if (b.is_error) {
            const errorText = normalizeToolErrorText(normalizedOutput)
            if (isCapturedExitPlanModeError(b.tool_use_id, errorText, state)) {
              continue
            }
            chunks.push(providerChunk.toolOutputError(b.tool_use_id, errorText))
          }
          else {
            const output = createClaudeCodeToolResult(
              b.tool_use_id,
              normalizedOutput,
              state,
            )
            const todoCapture = readTodoWriteCapture(b.tool_use_id, state)
            if (todoCapture) {
              capturedTodos.push(todoCapture)
            }
            const taskCapture = readTaskProgressCapture(b.tool_use_id, normalizedOutput, state)
            if (taskCapture) {
              capturedTodos.push(taskCapture)
            }
            chunks.push(providerChunk.toolOutputAvailable({
              toolCallId: b.tool_use_id,
              output,
            }))
            chunks.push(...projectClaudeToolResultImageFileChunks(normalizedOutput))
          }
        }
      }
    }
  }

  return { chunks, sessionId: msg.session_id ?? null, usage: null, capturedPlans: [], capturedTodos, capturedInteractionModes: [], capturedCrewCalls }
}

function mapContentBlock(
  block: BetaContentBlock,
  state: ClaudeAgentChunkMapperState,
): {
  chunks: UIMessageChunk[]
  capturedPlans: ClaudeAgentCapturedPlan[]
  capturedTodos: ClaudeAgentCapturedTodos[]
  capturedInteractionModes: ClaudeAgentCapturedInteractionMode[]
  capturedCrewCalls: ClaudeAgentCapturedCrewCall[]
} {
  const emptyCrew: ClaudeAgentCapturedCrewCall[] = []
  switch (block.type) {
    case 'text': {
      const chunks: UIMessageChunk[] = []
      if (!state.assistantStarted) {
        chunks.push(providerChunk.textStart(state.textItemId))
        state.assistantStarted = true
      }
      if (block.text) {
        chunks.push(providerChunk.textDelta(state.textItemId, block.text))
      }
      return { chunks, capturedPlans: [], capturedTodos: [], capturedInteractionModes: [], capturedCrewCalls: emptyCrew }
    }
    case 'thinking': {
      const itemId = `thinking-${state.textItemId}`
      const chunks: UIMessageChunk[] = [
        providerChunk.reasoningStart(itemId),
      ]
      if (block.thinking) {
        chunks.push(providerChunk.reasoningDelta(itemId, block.thinking))
      }
      chunks.push(providerChunk.reasoningEnd(itemId))
      return { chunks, capturedPlans: [], capturedTodos: [], capturedInteractionModes: [], capturedCrewCalls: emptyCrew }
    }
    case 'tool_use':
      if (!block.id || !block.name) {
        return { chunks: [], capturedPlans: [], capturedTodos: [], capturedInteractionModes: [], capturedCrewCalls: emptyCrew }
      }
      return emitToolUseChunks(block.id, block.name, block.input, state)
    default:
      return { chunks: [], capturedPlans: [], capturedTodos: [], capturedInteractionModes: [], capturedCrewCalls: emptyCrew }
  }
}

function mapStreamEvent(msg: SDKPartialAssistantMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  const capturedPlans: ClaudeAgentCapturedPlan[] = []
  const capturedTodos: ClaudeAgentCapturedTodos[] = []
  const capturedInteractionModes: ClaudeAgentCapturedInteractionMode[] = []
  let usage: TokenUsage | null = null

  switch (msg.event.type) {
    case 'message_delta': {
      const messageDeltaEvent = msg.event as BetaRawMessageDeltaEvent
      if (messageDeltaEvent.usage) {
        usage = {
          promptTokens: messageDeltaEvent.usage.input_tokens ?? 0,
          completionTokens: messageDeltaEvent.usage.output_tokens ?? 0,
          totalTokens: (messageDeltaEvent.usage.input_tokens ?? 0) + (messageDeltaEvent.usage.output_tokens ?? 0),
        }
      }
      const stopReason = messageDeltaEvent.delta?.stop_reason
      if (stopReason && isTerminalClaudeStopReason(stopReason)) {
        chunks.push(...finishOpenTextBlocks(state))
        chunks.push(providerChunk.finish('stop'))
      }
      break
    }
    case 'content_block_delta': {
      const deltaEvent = msg.event as BetaRawContentBlockDeltaEvent
      if (deltaEvent.delta.type === 'text_delta') {
        chunks.push(...ensureTextBlockStarted(state, deltaEvent.index))
        const textDelta = deltaEvent.delta.text ?? ''
        appendEmittedText(state, state.textItemId, textDelta)
        chunks.push(providerChunk.textDelta(state.textItemId, textDelta))
      }
      else if (deltaEvent.delta.type === 'thinking_delta') {
        const itemId = `thinking-${deltaEvent.index}`
        chunks.push(providerChunk.reasoningDelta(itemId, deltaEvent.delta.thinking ?? ''))
      }
      else if (deltaEvent.delta.type === 'input_json_delta') {
        const partialJson = (deltaEvent.delta as { type: 'input_json_delta', partial_json: string }).partial_json
        const toolId = state.activeToolBlockIds.get(deltaEvent.index)
        if (toolId && partialJson) {
          appendToolInputText(state, toolId, partialJson)
          chunks.push(providerChunk.toolInputDelta(toolId, partialJson))
        }
      }
      break
    }
    case 'content_block_start': {
      const startEvent = msg.event as BetaRawContentBlockStartEvent
      if (startEvent.content_block.type === 'text') {
        chunks.push(...ensureTextBlockStarted(state, startEvent.index))
        if (startEvent.content_block.text) {
          appendEmittedText(state, state.textItemId, startEvent.content_block.text)
          chunks.push(providerChunk.textDelta(state.textItemId, startEvent.content_block.text))
        }
      }
      else if (startEvent.content_block.type === 'thinking') {
        const itemId = `thinking-${startEvent.index}`
        state.activeThinkingBlockByIndex.set(startEvent.index, itemId)
        chunks.push(providerChunk.reasoningStart(itemId))
      }
      else if (startEvent.content_block.type === 'tool_use') {
        if (!startEvent.content_block.id || !startEvent.content_block.name) {
          break
        }
        state.hadToolCallSinceLastText = true
        state.activeToolBlockIds.set(startEvent.index, startEvent.content_block.id)
        const emitted = emitToolUseChunks(
          startEvent.content_block.id,
          startEvent.content_block.name,
          undefined,
          state,
        )
        chunks.push(...emitted.chunks)
        capturedPlans.push(...emitted.capturedPlans)
        capturedTodos.push(...emitted.capturedTodos)
        capturedInteractionModes.push(...emitted.capturedInteractionModes)
      }
      break
    }
    case 'content_block_stop': {
      const stopEvent = msg.event as { type: 'content_block_stop', index: number }
      const textItemId = state.activeTextBlockByIndex.get(stopEvent.index)
      if (textItemId !== undefined) {
        state.activeTextBlockByIndex.delete(stopEvent.index)
        state.completedTextBlockIndices.add(stopEvent.index)
        if (state.textItemId === textItemId) {
          state.assistantStarted = false
        }
        chunks.push(providerChunk.textEnd(textItemId))
        break
      }
      const thinkingItemId = state.activeThinkingBlockByIndex.get(stopEvent.index)
      if (thinkingItemId !== undefined) {
        state.activeThinkingBlockByIndex.delete(stopEvent.index)
        state.completedThinkingBlockIndices.add(stopEvent.index)
        chunks.push(providerChunk.reasoningEnd(thinkingItemId))
        break
      }
      const toolId = state.activeToolBlockIds.get(stopEvent.index)
      if (toolId !== undefined) {
        state.activeToolBlockIds.delete(stopEvent.index)
        const toolName = state.toolNamesByToolCallId.get(toolId)
        if (toolName) {
          const input = readToolCallArgs(toolId, state)
          const emitted = emitToolUseChunks(toolId, toolName, input, state)
          chunks.push(...emitted.chunks)
          capturedPlans.push(...emitted.capturedPlans)
          capturedTodos.push(...emitted.capturedTodos)
          capturedInteractionModes.push(...emitted.capturedInteractionModes)
        }
      }
      break
    }
  }

  return { chunks, sessionId: msg.session_id, usage, capturedPlans, capturedTodos, capturedInteractionModes, capturedCrewCalls: [] }
}

function clearCompletedAssistantBlockIndices(state: ClaudeAgentChunkMapperState): void {
  state.completedTextBlockIndices.clear()
  state.completedThinkingBlockIndices.clear()
}

function ensureTextBlockStarted(state: ClaudeAgentChunkMapperState, blockIndex: number): UIMessageChunk[] {
  const existingTextItemId = state.activeTextBlockByIndex.get(blockIndex)
  if (existingTextItemId) {
    state.textItemId = existingTextItemId
    return []
  }

  if (state.hadToolCallSinceLastText) {
    state.textItemId = randomUUID()
    state.hadToolCallSinceLastText = false
    state.assistantStarted = false
  }

  state.activeTextBlockByIndex.set(blockIndex, state.textItemId)
  if (state.assistantStarted) {
    return []
  }

  state.assistantStarted = true
  return [providerChunk.textStart(state.textItemId)]
}

function finishOpenTextBlocks(state: ClaudeAgentChunkMapperState): UIMessageChunk[] {
  if (state.activeTextBlockByIndex.size === 0 && !state.assistantStarted) {
    return []
  }

  const chunks: UIMessageChunk[] = []
  const seenTextItemIds = new Set<string>()
  if (state.activeTextBlockByIndex.size === 0 && state.assistantStarted) {
    seenTextItemIds.add(state.textItemId)
    chunks.push(providerChunk.textEnd(state.textItemId))
    state.assistantStarted = false
    return chunks
  }
  for (const [blockIndex, textItemId] of state.activeTextBlockByIndex) {
    if (seenTextItemIds.has(textItemId)) {
      continue
    }
    seenTextItemIds.add(textItemId)
    state.completedTextBlockIndices.add(blockIndex)
    chunks.push(providerChunk.textEnd(textItemId))
    if (state.textItemId === textItemId) {
      state.assistantStarted = false
    }
  }
  state.activeTextBlockByIndex.clear()
  return chunks
}

function isTerminalClaudeStopReason(stopReason: string): boolean {
  return stopReason !== 'tool_use'
}

function mapResult(msg: SDKResultMessage, state: ClaudeAgentChunkMapperState): ClaudeAgentChunkMapperResult {
  const usage = msg.usage
    ? {
        promptTokens: msg.usage.input_tokens ?? 0,
        completionTokens: msg.usage.output_tokens ?? 0,
        totalTokens: (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0),
      }
    : null

  return {
    chunks: [
      ...finishOpenTextBlocks(state),
      providerChunk.finish('stop'),
    ],
    sessionId: msg.session_id,
    usage,
    capturedPlans: [],
    capturedTodos: [],
    capturedInteractionModes: [],
    capturedCrewCalls: [],
  }
}

function emitAssistantTextSegment(
  text: string,
  state: ClaudeAgentChunkMapperState,
): { chunks: UIMessageChunk[] } {
  if (state.hadToolCallSinceLastText) {
    state.textItemId = randomUUID()
    state.hadToolCallSinceLastText = false
    state.assistantStarted = false
  }

  const previousText = readAccumulatedText(state.emittedTextByTextItemId.get(state.textItemId))
  const nextText = diffAssistantText(previousText, text)
  if (nextText.length === 0) {
    return { chunks: [] }
  }

  const chunks: UIMessageChunk[] = []
  if (!state.assistantStarted) {
    chunks.push(providerChunk.textStart(state.textItemId))
    state.assistantStarted = true
  }
  appendEmittedText(state, state.textItemId, nextText)
  chunks.push(providerChunk.textDelta(state.textItemId, nextText))
  return { chunks }
}

function diffAssistantText(previousText: string, nextText: string): string {
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length)
  }
  if (previousText.startsWith(nextText)) {
    return ''
  }

  let prefixLength = 0
  const limit = Math.min(previousText.length, nextText.length)
  while (prefixLength < limit && previousText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1
  }
  return nextText.slice(prefixLength)
}

function appendEmittedText(state: ClaudeAgentChunkMapperState, textItemId: string, text: string): void {
  appendAccumulatedText(state.emittedTextByTextItemId, textItemId, text)
}

function emitToolUseChunks(
  toolCallId: string,
  toolName: string,
  input: unknown,
  state: ClaudeAgentChunkMapperState,
): {
  chunks: UIMessageChunk[]
  capturedPlans: ClaudeAgentCapturedPlan[]
  capturedTodos: ClaudeAgentCapturedTodos[]
  capturedInteractionModes: ClaudeAgentCapturedInteractionMode[]
  capturedCrewCalls: ClaudeAgentCapturedCrewCall[]
} {
  const current = state.emittedToolStateByToolCallId.get(toolCallId) ?? { started: false, inputAvailable: false }
  const chunks: UIMessageChunk[] = []
  const capturedPlans: ClaudeAgentCapturedPlan[] = []
  const capturedTodos: ClaudeAgentCapturedTodos[] = []
  const capturedInteractionModes: ClaudeAgentCapturedInteractionMode[] = []
  const capturedCrewCalls: ClaudeAgentCapturedCrewCall[] = []
  state.toolNamesByToolCallId.set(toolCallId, toolName)

  if (!current.started) {
    chunks.push(providerChunk.toolInputStart(toolCallId, toolName))
    current.started = true
  }

  if (input !== undefined && !current.inputAvailable) {
    state.toolArgsByToolCallId.set(toolCallId, input)
    captureClaudePlanFileWrite(toolName, input, state)
    chunks.push(providerChunk.toolInputAvailable({
      toolCallId,
      toolName,
      input: createClaudeCodeToolInputPayload(toolName, input),
    }))
    current.inputAvailable = true
    const todoPluginState = isTodoWriteToolName(toolName) ? synthesizeTodoWritePluginState(input) : null
    if (todoPluginState) {
      capturedTodos.push({ toolCallId, todos: todoPluginState.todos })
    }
    captureClaudeAgentTaskToolInput(toolCallId, toolName, input, state.taskProgress)

    // Capture Agent tool calls as crew calls
    const normalizedToolName = normalizeClaudeCodeToolApiName(toolName)
    if (normalizedToolName === ClaudeCodeToolName.Agent || normalizedToolName === ClaudeCodeToolName.Workflow) {
      const args = (input ?? {}) as Record<string, unknown>
      capturedCrewCalls.push({
        toolCallId,
        tool: normalizedToolName,
        agentId: null,
        prompt: typeof args.prompt === 'string' ? args.prompt : null,
        description: typeof args.description === 'string' ? args.description : null,
        subagentType: typeof args.subagent_type === 'string'
          ? args.subagent_type
          : typeof args.subagentType === 'string'
            ? args.subagentType
            : null,
        model: typeof args.model === 'string' ? args.model : null,
        reasoningEffort: typeof args.reasoningEffort === 'string' ? args.reasoningEffort : null,
        tools: Array.isArray(args.tools) ? args.tools.filter((tool): tool is string => typeof tool === 'string') : [],
        outputFile: null,
        runInBackground: args.run_in_background === true,
        status: 'running',
        startedAt: Date.now(),
        completedAt: null,
      })
    }
  }

  if (isClaudeAgentEnterPlanModeToolName(toolName) && !current.interactionModeCaptured) {
    capturedInteractionModes.push({ toolCallId, interactionMode: 'plan' })
    current.interactionModeCaptured = true
  }

  const exitPlan = readExitPlanModePlanContent(toolName, input, state)
  if (exitPlan && !current.outputAvailable) {
    state.capturedExitPlanToolCallIds.add(toolCallId)
    capturedPlans.push({ toolCallId, content: exitPlan })
    chunks.push(providerChunk.toolOutputAvailable({
      toolCallId,
      output: createClaudeCodeToolResultPayload({
        apiName: toolName,
        args: input,
        result: { plan: exitPlan },
      }),
    }))
    current.outputAvailable = true
  }

  state.emittedToolStateByToolCallId.set(toolCallId, current)
  if (exitPlan) {
    chunks.push(...emitPlanImplementationApprovalChunks(toolCallId, exitPlan, state))
  }
  return { chunks, capturedPlans, capturedTodos, capturedInteractionModes, capturedCrewCalls }
}

function readClaudeAgentAsyncLaunchResult(output: unknown): { status: 'async_launched', agentId: string | null, outputFile: string | null } | null {
  if (!output || typeof output !== 'object') {
    return null
  }
  const record = output as Record<string, unknown>
  if (record.status !== 'async_launched') {
    return null
  }
  return {
    status: 'async_launched',
    agentId: typeof record.agentId === 'string' ? record.agentId : null,
    outputFile: typeof record.outputFile === 'string' ? record.outputFile : null,
  }
}

function readExitPlanModePlan(toolName: string, input: unknown): string | null {
  if (!isClaudeAgentExitPlanModeToolName(toolName)) {
    return null
  }
  if (!isRecord(input)) {
    return null
  }
  const plan = typeof input.plan === 'string' ? input.plan.trim() : ''
  return plan.length > 0 ? plan : null
}

function captureClaudePlanFileWrite(
  toolName: string,
  input: unknown,
  state: ClaudeAgentChunkMapperState,
): void {
  if (normalizeClaudeCodeToolApiName(toolName) !== ClaudeCodeToolName.Write || !isRecord(input)) {
    return
  }
  const filePath = typeof input.file_path === 'string'
    ? input.file_path
    : typeof input.filePath === 'string'
      ? input.filePath
      : ''
  if (!filePath.includes(CLAUDE_PLAN_FILE_PATH_SEGMENT) || !filePath.endsWith('.md')) {
    return
  }
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    return
  }
  state.latestPlanFileContent = input.content
}

function readExitPlanModePlanContent(
  toolName: string,
  input: unknown,
  state: ClaudeAgentChunkMapperState,
): string | null {
  const explicitPlan = readExitPlanModePlan(toolName, input)
  if (explicitPlan) {
    return explicitPlan
  }
  if (!isClaudeAgentExitPlanModeToolName(toolName) || !isRecord(input) || !hasAllowedPrompts(input.allowedPrompts)) {
    return null
  }
  const plan = state.latestPlanFileContent?.trim() ?? ''
  return plan.length > 0 ? plan : null
}

function hasAllowedPrompts(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function emitPlanImplementationApprovalChunks(
  sourceToolCallId: string,
  planContent: string,
  state: ClaudeAgentChunkMapperState,
): UIMessageChunk[] {
  const toolCallId = `implement-plan:${sourceToolCallId}`
  const current = state.emittedToolStateByToolCallId.get(toolCallId) ?? { started: false, inputAvailable: false }
  const chunks: UIMessageChunk[] = []
  if (!current.started) {
    chunks.push(providerChunk.toolInputStart(toolCallId, PLAN_IMPLEMENTATION_TOOL_NAME))
    current.started = true
  }
  if (!current.inputAvailable) {
    chunks.push(providerChunk.toolInputAvailable({
      toolCallId,
      toolName: PLAN_IMPLEMENTATION_TOOL_NAME,
      input: createClaudeCodeToolInputPayload(PLAN_IMPLEMENTATION_TOOL_NAME, {
        turnId: sourceToolCallId,
        planContent,
      }),
    }))
    current.inputAvailable = true
  }
  if (!current.approvalRequested) {
    chunks.push(providerChunk.toolApprovalRequest(toolCallId))
    current.approvalRequested = true
  }
  state.emittedToolStateByToolCallId.set(toolCallId, current)
  return chunks
}

function isCapturedExitPlanModeError(
  toolCallId: string,
  errorText: string,
  state: ClaudeAgentChunkMapperState,
): boolean {
  const toolName = state.toolNamesByToolCallId.get(toolCallId)
  return toolName !== undefined
    && isClaudeAgentExitPlanModeToolName(toolName)
    && state.capturedExitPlanToolCallIds.has(toolCallId)
    && (
      errorText === CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE
      || errorText === 'Exit plan mode?'
      || errorText === 'Error: Exit plan mode?'
    )
}

function appendToolInputText(
  state: ClaudeAgentChunkMapperState,
  toolCallId: string,
  inputTextDelta: string,
): void {
  appendAccumulatedText(state.toolInputTextByToolCallId, toolCallId, inputTextDelta)
}

function appendAccumulatedText(target: Map<string, TextAccumulator>, key: string, text: string): void {
  const accumulator = target.get(key) ?? { parts: [], length: 0 }
  accumulator.parts.push(text)
  accumulator.length += text.length
  target.set(key, accumulator)
}

function readAccumulatedText(accumulator: TextAccumulator | undefined): string {
  if (!accumulator) {
    return ''
  }
  if (accumulator.parts.length <= 1) {
    return accumulator.parts[0] ?? ''
  }
  const text = accumulator.parts.join('')
  accumulator.parts = [text]
  return text
}

function createClaudeCodeToolResult(
  toolCallId: string,
  result: unknown,
  state: ClaudeAgentChunkMapperState,
): unknown {
  const toolName = state.toolNamesByToolCallId.get(toolCallId)
  if (!toolName) {
    return result
  }

  const args = readToolCallArgs(toolCallId, state)
  const enrichedResult = attachTodoWritePluginState(toolName, args, result)
  return createClaudeCodeToolResultPayload({
    apiName: toolName,
    args,
    result: enrichedResult,
  })
}

function readTodoWriteCapture(toolCallId: string, state: ClaudeAgentChunkMapperState): ClaudeAgentCapturedTodos | null {
  const toolName = state.toolNamesByToolCallId.get(toolCallId)
  if (!toolName || !isTodoWriteToolName(toolName)) {
    return null
  }
  const pluginState = synthesizeTodoWritePluginState(readToolCallArgs(toolCallId, state))
  return pluginState ? { toolCallId, todos: pluginState.todos } : null
}

function readTaskProgressCapture(toolCallId: string, output: unknown, state: ClaudeAgentChunkMapperState): ClaudeAgentCapturedTodos | null {
  const toolName = state.toolNamesByToolCallId.get(toolCallId)
  if (!toolName) {
    return null
  }
  const todos = captureClaudeAgentTaskToolResult(toolCallId, toolName, output, state.taskProgress)
  return todos ? { toolCallId, todos, source: 'Task' } : null
}

function readToolCallArgs(toolCallId: string, state: ClaudeAgentChunkMapperState): unknown {
  return state.toolArgsByToolCallId.get(toolCallId)
    ?? parseToolInputText(readAccumulatedText(state.toolInputTextByToolCallId.get(toolCallId)))
}

function attachTodoWritePluginState(
  toolName: string,
  input: unknown,
  output: unknown,
): unknown {
  if (!isTodoWriteToolName(toolName)) {
    return output
  }
  const pluginState = synthesizeTodoWritePluginState(input)
  if (!pluginState) {
    return output
  }

  if (isRecord(output)) {
    const existingPluginState = isRecord(output.pluginState) ? output.pluginState : {}
    return {
      ...output,
      pluginState: {
        ...existingPluginState,
        todos: pluginState.todos,
      },
    }
  }

  return {
    result: output,
    pluginState: {
      todos: pluginState.todos,
    },
  }
}

function parseToolInputText(inputText: string | undefined): unknown {
  if (!inputText) {
    return undefined
  }
  try {
    return JSON.parse(inputText)
  }
  catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readToolResultContent(msg: SDKUserMessage, block: { content?: unknown }): unknown {
  const toolUseResult = (msg as { tool_use_result?: unknown }).tool_use_result
  if (toolUseResult !== undefined && countToolResultBlocks(msg.message.content) === 1) {
    return toolUseResult
  }
  return block.content
}

function countToolResultBlocks(content: SDKUserMessage['message']['content']): number {
  if (!Array.isArray(content)) {
    return 0
  }
  return content.filter(block => isRecord(block) && block.type === 'tool_result').length
}

/**
 * Normalize tool_result content for the frontend classifier.
 * Objects/arrays are passed through as-is so the classifier can read
 * structured fields (e.g. TodoWriteOutput.newTodos, ExitPlanModeOutput.plan).
 * Strings are attempt-parsed as JSON in case the SDK serialized a structured output.
 */
function normalizeToolResultContent(content: unknown): unknown {
  if (content == null) {
    return ''
  }
  if (typeof content === 'object') {
    return content
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    }
    catch {
      return content
    }
  }
  return String(content)
}

function projectClaudeToolResultImageFileChunks(content: unknown): UIMessageChunk[] {
  const blocks = Array.isArray(content) ? content : [content]
  return blocks.flatMap(projectClaudeToolResultImageFileChunk)
}

function projectClaudeToolResultImageFileChunk(block: unknown): UIMessageChunk[] {
  if (!isRecord(block) || block.type !== 'image') {
    return []
  }
  const source = isRecord(block.source) ? block.source : null
  if (!source) {
    return []
  }

  switch (source.type) {
    case 'base64': {
      const mediaType = typeof source.media_type === 'string' ? source.media_type : null
      const data = typeof source.data === 'string' ? source.data : null
      return mediaType && data
        ? [providerChunk.file({ mediaType, url: `data:${mediaType};base64,${data}` })]
        : []
    }
    case 'url': {
      const url = typeof source.url === 'string' ? source.url : null
      return url ? [providerChunk.file({ mediaType: 'image/*', url })] : []
    }
    default:
      return []
  }
}

function normalizeToolErrorText(output: unknown): string {
  if (typeof output === 'string') {
    return output || 'Tool execution failed'
  }
  if (output == null) {
    return 'Tool execution failed'
  }
  try {
    return JSON.stringify(output)
  }
  catch {
    return String(output)
  }
}
