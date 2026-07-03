import type { UIMessageChunk } from 'ai'

import { currentUnixSeconds } from '../../../helpers/time'
import {
  compactStoredMessageSnapshot
} from '../message-snapshot-compaction'
import { commitSessionEvents, readRunStopReason, readRunTerminalEventType } from '../es/commands'
import {
  flushFinalMessageProjection,
  flushProjectedToolInputs,
  projectFinalMessageChunk
} from './final-message-projection'
import { readRunWriteFence, type RunWriteFence } from './run-write-fence'
import type { ChatMessageStatus } from './stream-chunks'
import { readTerminalStatus } from './stream-chunks'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../stream-trace'
import { attachBinding } from '../runtime-session-context'
import type { ActiveRun, TerminalChatMessageStatus } from '../run-registry'
import type { ChatRuntimeProfile } from './profile'
import {
  extractMessageText,
  normalizeMessageSnapshot
} from '../ui-message'

export interface TerminalRunFinalizerDeps {
  stream: {
    publishRunStartChunk(activeRun: ActiveRun): void
    flushPendingRunDelta(activeRun: ActiveRun): void
    publishUIMessageChunk(activeRun: ActiveRun, chunk: UIMessageChunk, terminal: boolean): void
  }
  error(message: string, payload: Record<string, unknown>): void
}

export function createTerminalRunFinalizer(deps: TerminalRunFinalizerDeps) {
  async function publishTerminalChunk(
    activeRun: ActiveRun,
    chunk: UIMessageChunk,
    profile?: ChatRuntimeProfile
  ): Promise<boolean> {
    deps.stream.publishRunStartChunk(activeRun)
    deps.stream.flushPendingRunDelta(activeRun)
    const status = readTerminalStatus(chunk)
    const errorText = chunk.type === 'error' ? chunk.errorText : null
    const finalized = await finalizeActiveRun(activeRun, status, errorText, chunk, profile)
    if (!finalized) {
      return false
    }
    deps.stream.publishUIMessageChunk(activeRun, chunk, true)
    return true
  }

  async function finalizeActiveRun(
    activeRun: ActiveRun,
    status: ChatMessageStatus,
    errorText: string | null,
    terminalChunk: UIMessageChunk,
    profile?: ChatRuntimeProfile
  ): Promise<boolean> {
    if (status === 'streaming' || activeRun.terminalStatus) {
      return false
    }

    const fence = readRunWriteFence(activeRun.runId)
    if (fence.status !== 'streaming') {
      deps.stream.publishUIMessageChunk(activeRun, terminalChunkForFence(fence), true)
      if (fence.status !== 'missing') {
        activeRun.terminalStatus = fence.status
      }
      return false
    }

    activeRun.terminalStatus = status
    if (profile) {
      profile.finalizeStartedAtMs = performance.now()
    }
    projectFinalMessageChunk(activeRun, terminalChunk)
    flushFinalMessageProjection(activeRun)
    await flushProjectedToolInputs(activeRun)

    const bindingId = recordTerminalRunBindingId(activeRun)
    const snapshotResult = await persistTerminalMessageSnapshot(
      activeRun,
      status,
      errorText,
      bindingId
    )
    if (profile) {
      profile.finalMessageJsonBytes = snapshotResult?.messageJsonBytes ?? null
    }
    if (profile) {
      profile.finalizeFinishedAtMs = performance.now()
      profile.memoryFinished = profile.enabled ? process.memoryUsage() : null
    }
    if (isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        providerSessionId: activeRun.runtimeSession.providerSessionId,
        phase:
          status === 'complete'
            ? 'run_completed'
            : status === 'aborted'
              ? 'run_aborted'
              : 'run_failed',
        payload: {
          status,
          errorText,
          message: activeRun.finalMessage
        }
      })
    }
    return true
  }

  async function settleActiveRun(
    activeRun: ActiveRun,
    status: TerminalChatMessageStatus,
    errorText: string | null
  ): Promise<void> {
    if (activeRun.terminalStatus) {
      return
    }
    if (status === 'aborted') {
      activeRun.cancelRequested = true
    }
    const terminalChunk: UIMessageChunk =
      status === 'complete'
        ? { type: 'finish', finishReason: 'stop' }
        : status === 'aborted'
          ? { type: 'abort', reason: 'user' }
          : { type: 'error', errorText: errorText ?? 'Chat run failed' }
    await publishTerminalChunk(activeRun, terminalChunk)
  }

  async function persistTerminalMessageSnapshot(
    activeRun: ActiveRun,
    status: TerminalChatMessageStatus,
    errorText: string | null,
    bindingId?: string | null
  ): Promise<{ messageJsonBytes: number } | null> {
    try {
      const now = currentUnixSeconds()
      const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(activeRun.finalMessage))
      const messageJson = JSON.stringify(message)
      await commitSessionEvents(activeRun.sessionId, [
        {
          type: 'AssistantMessageCompleted',
          payload: {
            message: {
              id: activeRun.messageId,
              sessionId: activeRun.sessionId,
              content: extractMessageText(message),
              messageJson,
              status,
              errorText,
              updatedAt: now
            }
          }
        },
        {
          type: readRunTerminalEventType(status),
          payload: {
            runId: activeRun.runId,
            sessionId: activeRun.sessionId,
            queueItemId: activeRun.queueItemId ?? null,
            ...(bindingId !== undefined ? { bindingId } : {}),
            status,
            stopReason: readRunStopReason(status),
            errorText,
            finishedAt: now
          }
        }
      ])
      return { messageJsonBytes: Buffer.byteLength(messageJson) }
    } catch (error) {
      deps.error('failed to persist final message snapshot', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
        status
      })
      return null
    }
  }

  return {
    publishTerminalChunk,
    settleActiveRun
  }
}

export function terminalChunkForFence(fence: RunWriteFence): UIMessageChunk {
  switch (fence.status) {
    case 'streaming':
    case 'complete':
      return { type: 'finish', finishReason: 'stop' }
    case 'aborted':
      return { type: 'abort', reason: 'user' }
    case 'failed':
      return { type: 'error', errorText: fence.errorText ?? 'Chat run failed' }
    case 'missing':
      return { type: 'error', errorText: 'Chat run is no longer available' }
  }
}

function recordTerminalRunBindingId(activeRun: ActiveRun): string | undefined {
  try {
    return attachBinding({
      sessionId: activeRun.sessionId,
      providerTargetId: activeRun.providerTargetId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      runtimeSession: activeRun.runtimeSession,
      requestedModelId: activeRun.modelId
    })?.id
  } catch {
    return undefined
  }
}
