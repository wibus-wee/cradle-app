import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import { publishProviderThreadEvent } from '../provider-threads/live-streams'
import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import type { ProviderSyntheticTurnEvent } from '../runtime-provider-types'
import { providerThreadStreamStore, waitForRunCompletion } from '../stream/live-run-streams'
import { createActiveRunChunkLog } from '../stream/run-chunk-log'
import { createAssistantMessage } from '../ui-message'
import { createFinalMessageProjectionState } from './final-message-projection'
import { isTerminalUIMessageChunk } from './stream-chunks'
import type { ActiveTurnCompletionController } from './turn-completion'
import { startRun } from './turn-draft'

interface ProviderSyntheticTurnHandlerDeps {
  stream: {
    publishRunStartChunk: (activeRun: ActiveRun) => void
    publishRuntimeChunk: (activeRun: ActiveRun, chunk: UIMessageChunk) => void
  }
  completeActiveTurn: ActiveTurnCompletionController['completeActiveTurn']
}

interface ProviderSyntheticTurnState {
  providerTurnId: string
  providerThreadId: null
  activeRun: ActiveRun
  completionStarted: boolean
}

interface ProviderSyntheticTurnInboxEntry {
  tail: Promise<void>
  state: ProviderSyntheticTurnState | null
  closed: boolean
  pendingDeliveries: number
}

export function createProviderSyntheticTurnEventHandler(
  parentRun: ActiveRun,
  deps: ProviderSyntheticTurnHandlerDeps,
): (event: ProviderSyntheticTurnEvent) => Promise<void> {
  const syntheticTurns = new Map<string, ProviderSyntheticTurnInboxEntry>()

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

    let inbox = syntheticTurns.get(event.providerTurnId)
    if (!inbox) {
      inbox = {
        tail: Promise.resolve(),
        state: null,
        closed: false,
        pendingDeliveries: 0,
      }
      syntheticTurns.set(event.providerTurnId, inbox)
    }

    inbox.pendingDeliveries += 1
    const delivery = inbox.tail.then(async () => {
      if (inbox.closed) {
        return
      }
      if (!inbox.state) {
        inbox.state = await startProviderSyntheticTurn(parentRun, event)
      }

      try {
        for (const chunk of event.chunks) {
          await applyProviderSyntheticTurnChunk(inbox.state, chunk, deps)
          if (inbox.state.activeRun.terminalStatus) {
            inbox.closed = true
            break
          }
        }
      }
      catch (error) {
        inbox.closed = true
        if (!inbox.state.completionStarted && !inbox.state.activeRun.terminalStatus) {
          await finalizeProviderSyntheticTurn(
            inbox.state,
            { type: 'error', errorText: error instanceof Error ? error.message : String(error) },
            deps,
          )
        }
        throw error
      }
    }).finally(() => {
      inbox.pendingDeliveries -= 1
      if (inbox.closed && inbox.pendingDeliveries === 0 && syntheticTurns.get(event.providerTurnId) === inbox) {
        syntheticTurns.delete(event.providerTurnId)
      }
    })
    inbox.tail = delivery.catch(() => undefined)
    return delivery
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
    runChunkLog: createActiveRunChunkLog(run.id),
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
    usageEventCount: 0,
    usageEventAggregate: null,
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
    completionStarted: false,
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

  syntheticTurn.completionStarted = true
  await deps.completeActiveTurn(activeRun, {
    source: 'provider-synthetic',
    terminalChunk,
  })
}
