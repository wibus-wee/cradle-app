import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import { publishProviderThreadEvent } from '../provider-threads/live-streams'
import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import type { ProviderSyntheticTurnEvent } from '../runtime-provider-types'
import { providerThreadStreamStore, waitForRunCompletion } from '../stream/live-run-streams'
import { createAssistantMessage } from '../ui-message'
import { createFinalMessageProjectionState } from './final-message-projection'
import { isTerminalUIMessageChunk } from './stream-chunks'
import { startRun } from './turn-draft'

interface ProviderSyntheticTurnHandlerDeps {
  stream: {
    publishRunStartChunk: (activeRun: ActiveRun) => void
    publishRuntimeChunk: (activeRun: ActiveRun, chunk: UIMessageChunk) => void
  }
  publishTerminalChunk: (activeRun: ActiveRun, chunk: UIMessageChunk) => Promise<boolean>
  releaseActiveRun: (activeRun: ActiveRun) => void
  scheduleQueueDrain: (sessionId: string) => void
}

interface ProviderSyntheticTurnState {
  providerTurnId: string
  providerThreadId: null
  activeRun: ActiveRun
}

export function createProviderSyntheticTurnEventHandler(
  parentRun: ActiveRun,
  deps: ProviderSyntheticTurnHandlerDeps,
): (event: ProviderSyntheticTurnEvent) => Promise<void> {
  const syntheticTurns = new Map<string, ProviderSyntheticTurnState>()

  return async (event) => {
    if (event.chunks.length === 0) {
      return
    }

    if (event.providerThreadId) {
      publishProviderThreadEvent({
        store: providerThreadStreamStore,
        sessionId: parentRun.sessionId,
        event: {
          providerThreadId: event.providerThreadId,
          providerTurnId: event.providerTurnId,
          notification: { type: 'providerSyntheticTurn' },
          chunks: event.chunks,
        },
        isTerminalChunk: isTerminalUIMessageChunk,
      })
      return
    }

    let syntheticTurn = syntheticTurns.get(event.providerTurnId)
    try {
      if (!syntheticTurn) {
        syntheticTurn = await startProviderSyntheticTurn(parentRun, event)
        syntheticTurns.set(event.providerTurnId, syntheticTurn)
      }

      for (const chunk of event.chunks) {
        await applyProviderSyntheticTurnChunk(syntheticTurn, chunk, deps)
        if (syntheticTurn.activeRun.terminalStatus) {
          syntheticTurns.delete(event.providerTurnId)
          break
        }
      }
    }
    catch (error) {
      if (syntheticTurn && !syntheticTurn.activeRun.terminalStatus) {
        syntheticTurns.delete(event.providerTurnId)
        await finalizeProviderSyntheticTurn(
          syntheticTurn,
          { type: 'error', errorText: error instanceof Error ? error.message : String(error) },
          deps,
        )
      }
      throw error
    }
  }
}

async function startProviderSyntheticTurn(
  parentRun: ActiveRun,
  event: ProviderSyntheticTurnEvent,
): Promise<ProviderSyntheticTurnState> {
  // The provider can emit the first background continuation immediately after closing the
  // parent stream. Wait until the parent's terminal fact is durable before starting the next
  // system run so the session aggregate never observes two concurrent top-level runs.
  await waitForRunCompletion(parentRun.runId, { timeoutMs: null })

  const messageId = randomUUID()
  const assistantMessage = createAssistantMessage(messageId)
  const run = await startRun({
    sessionId: parentRun.sessionId,
    messageId,
    origin: 'system',
    assistantMessage,
  })
  const activeRun: ActiveRun = {
    runId: run.id,
    sessionId: parentRun.sessionId,
    messageId,
    providerTargetKind: parentRun.providerTargetKind,
    providerTargetId: parentRun.providerTargetId,
    runtime: parentRun.runtime,
    runtimeSession: parentRun.runtimeSession,
    modelId: parentRun.modelId,
    chunkBuffer: [],
    chunkBufferIndexByKey: new Map(),
    chunkBufferDroppedCount: 0,
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: assistantMessage,
    finalProjection: createFinalMessageProjectionState(),
    firstTokenDeltaSnapshotRecorded: false,
    firstTextDeltaSnapshotRecorded: false,
    lastStreamingSnapshotMessageJson: null,
    pendingStreamingSnapshotMessageJson: null,
    runtimeSettings: parentRun.runtimeSettings,
    runSnapshotId: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotTruncatedEventId: null,
    runSnapshotDroppedEventCount: 0,
  }
  runRegistry.setActiveRun(activeRun.runId, activeRun)
  runRegistry.setActiveRunIdForSession(activeRun.sessionId, activeRun.runId)

  return {
    providerTurnId: event.providerTurnId,
    providerThreadId: null,
    activeRun,
  }
}

async function applyProviderSyntheticTurnChunk(
  syntheticTurn: ProviderSyntheticTurnState,
  chunk: UIMessageChunk,
  deps: ProviderSyntheticTurnHandlerDeps,
): Promise<void> {
  const activeRun = syntheticTurn.activeRun
  if (activeRun.terminalStatus) {
    return
  }

  if (isTerminalUIMessageChunk(chunk)) {
    await finalizeProviderSyntheticTurn(syntheticTurn, chunk, deps)
    return
  }

  if (chunk.type !== 'start') {
    deps.stream.publishRunStartChunk(activeRun)
  }
  if (chunk.type === 'start' && activeRun.startChunkPublished) {
    return
  }
  deps.stream.publishRuntimeChunk(activeRun, chunk)
}

async function finalizeProviderSyntheticTurn(
  syntheticTurn: ProviderSyntheticTurnState,
  terminalChunk: UIMessageChunk,
  deps: ProviderSyntheticTurnHandlerDeps,
): Promise<void> {
  const activeRun = syntheticTurn.activeRun
  if (activeRun.terminalStatus) {
    return
  }

  try {
    await deps.publishTerminalChunk(activeRun, terminalChunk)
  }
  finally {
    deps.releaseActiveRun(activeRun)
    deps.scheduleQueueDrain(activeRun.sessionId)
  }
}
