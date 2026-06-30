import type { UIMessageChunk } from 'ai'

import { appendRunSnapshotEvent, finalizeRunSnapshot } from '../run-snapshot'
import type { RunSnapshotStatus } from '../run-snapshot'
import type { TerminalChatMessageStatus } from './stream-chunks'
import { readTerminalStatus } from './stream-chunks'

export interface SnapshotEventRun {
  runSnapshotId?: string | null
  runSnapshotSeq: number
  sessionId: string
  runId: string
  modelId: string | null
  runtimeSession: {
    providerSessionId: string | null
  }
}

export interface RuntimeProfileSummaryInput {
  enabled: boolean
  streamStartedAtMs: number
  streamFinishedAtMs: number | null
  finalizeStartedAtMs: number | null
  finalizeFinishedAtMs: number | null
  finalMessageJsonBytes: number | null
}

export function readHarnessSnapshotPhase(chunk: UIMessageChunk): string {
  switch (chunk.type) {
    case 'start':
      return 'model_stream_started'
    case 'text-start':
      return 'model_text_started'
    case 'text-delta':
      return 'model_text_delta'
    case 'text-end':
      return 'model_text_completed'
    case 'reasoning-start':
      return 'model_reasoning_started'
    case 'reasoning-delta':
      return 'model_reasoning_delta'
    case 'reasoning-end':
      return 'model_reasoning_completed'
    case 'tool-input-start':
      return 'tool_call_started'
    case 'tool-input-delta':
      return 'tool_call_input_delta'
    case 'tool-input-available':
      return 'tool_call_input_available'
    case 'tool-input-error':
      return 'tool_call_input_failed'
    case 'tool-output-available':
      return 'tool_call_output_available'
    case 'tool-output-error':
      return 'tool_call_output_failed'
    case 'tool-output-denied':
      return 'tool_call_denied'
    case 'finish':
      return 'model_stream_finished'
    case 'abort':
      return 'run_aborted'
    case 'error':
      return 'run_failed'
    default:
      return `runtime_chunk:${chunk.type}`
  }
}

export function shouldRecordHarnessSnapshotChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
    case 'tool-input-delta':
      return false
    default:
      return true
  }
}

export function recordActiveRunSnapshotEvent(
  activeRun: SnapshotEventRun,
  input: {
    phase: string
    chunk?: UIMessageChunk
    modelId?: string | null
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
    estimatedCostUsd?: number | null
    durationMs?: number | null
    payload?: Record<string, unknown>
    truncatePayload: (value: unknown) => unknown
  }
): void {
  if (!activeRun.runSnapshotId) {
    return
  }
  const chunk = input.chunk
  appendRunSnapshotEvent({
    snapshotId: activeRun.runSnapshotId,
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    seq: activeRun.runSnapshotSeq,
    phase: input.phase,
    chunkType: chunk?.type,
    toolCallId: chunk ? readChunkTraceToolCallId(chunk) : null,
    toolName: chunk ? readChunkTraceToolName(chunk) : null,
    modelId: input.modelId ?? activeRun.modelId,
    promptTokens: input.usage?.promptTokens,
    completionTokens: input.usage?.completionTokens,
    totalTokens: input.usage?.totalTokens,
    estimatedCostUsd: input.estimatedCostUsd,
    durationMs: input.durationMs,
    payload: input.payload ?? (chunk ? summarizeSnapshotChunk(chunk, input.truncatePayload) : {})
  })
  activeRun.runSnapshotSeq += 1
}

export function finalizeActiveRunSnapshot(
  activeRun: SnapshotEventRun,
  finalChunk: UIMessageChunk,
  input: {
    modelId: string | null
    diagnostics: Record<string, unknown>
    profile: RuntimeProfileSummaryInput
    replayBuffer: Record<string, unknown>
    truncatePayload: (value: unknown) => unknown
  }
): void {
  if (!activeRun.runSnapshotId) {
    return
  }
  const status = toRunSnapshotStatus(readTerminalStatus(finalChunk))
  const profileSummary = {
    enabled: input.profile.enabled,
    streamMs: input.profile.streamFinishedAtMs
      ? Math.round(input.profile.streamFinishedAtMs - input.profile.streamStartedAtMs)
      : null,
    finalizeMs:
      input.profile.finalizeFinishedAtMs && input.profile.finalizeStartedAtMs
        ? Math.round(input.profile.finalizeFinishedAtMs - input.profile.finalizeStartedAtMs)
        : null,
    finalMessageJsonBytes: input.profile.finalMessageJsonBytes
  }
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'run_finalized',
    chunk: finalChunk,
    modelId: input.modelId,
    truncatePayload: input.truncatePayload,
    payload: {
      status,
      terminalChunk: summarizeSnapshotChunk(finalChunk, input.truncatePayload),
      replayBuffer: input.replayBuffer,
      diagnostics: input.diagnostics,
      profile: profileSummary
    }
  })
  finalizeRunSnapshot({
    snapshotId: activeRun.runSnapshotId,
    status,
    completionReason: readSnapshotCompletionReason(finalChunk),
    errorText: finalChunk.type === 'error' ? finalChunk.errorText : null,
    modelId: input.modelId,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    summary: {
      diagnostics: input.diagnostics,
      profile: profileSummary,
      replayBuffer: input.replayBuffer
    }
  })
}

export function summarizeSnapshotChunk(
  chunk: UIMessageChunk,
  truncatePayload: (value: unknown) => unknown
): Record<string, unknown> {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return {
        id: chunk.id,
        deltaChars: chunk.delta.length,
        providerMetadata: chunk.providerMetadata ?? null
      }
    case 'tool-input-delta':
      return {
        toolCallId: chunk.toolCallId,
        inputDeltaChars: chunk.inputTextDelta.length
      }
    case 'tool-input-available':
      return {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: truncatePayload(chunk.input)
      }
    case 'tool-output-available':
      return {
        toolCallId: chunk.toolCallId,
        output: truncatePayload(chunk.output)
      }
    case 'error':
      return {
        errorText: chunk.errorText
      }
    case 'finish':
      return {
        finishReason: chunk.finishReason
      }
    case 'abort':
      return {
        reason: chunk.reason
      }
    default:
      return truncatePayload(chunk) as Record<string, unknown>
  }
}

export function readChunkTraceToolCallId(chunk: UIMessageChunk): string | null {
  const value = (chunk as { toolCallId?: unknown }).toolCallId
  return typeof value === 'string' ? value : null
}

export function readChunkTraceToolName(chunk: UIMessageChunk): string | null {
  const value = (chunk as { toolName?: unknown }).toolName
  return typeof value === 'string' ? value : null
}

function readSnapshotCompletionReason(chunk: UIMessageChunk): string {
  if (chunk.type === 'finish') {
    return chunk.finishReason ?? 'stop'
  }
  if (chunk.type === 'abort') {
    return chunk.reason ?? 'abort'
  }
  if (chunk.type === 'error') {
    return 'error'
  }
  return chunk.type
}

function toRunSnapshotStatus(status: TerminalChatMessageStatus): RunSnapshotStatus {
  return status === 'complete' ? 'complete' : status === 'aborted' ? 'aborted' : 'failed'
}
