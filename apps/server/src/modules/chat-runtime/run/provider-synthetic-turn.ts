import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import { currentUnixSeconds } from '../../../helpers/time'
import { commitSessionEvents, readRunStopReason, readRunTerminalEventType } from '../es/commands'
import type { BackendRunStartedFact } from '../es/events'
import { compactStoredMessageSnapshot } from '../message-snapshot-compaction'
import { publishProviderThreadEvent } from '../provider-threads/live-streams'
import type { ActiveRun, TerminalChatMessageStatus } from '../run-registry'
import type { ProviderSyntheticTurnEvent, RuntimeSession } from '../runtime-provider-types'
import { attachBinding } from '../runtime-session-context'
import { providerThreadStreamStore } from '../stream/live-run-streams'
import {
  createAssistantMessage,
  extractMessageText,
  normalizeMessageSnapshot,
} from '../ui-message'
import type { FinalMessageProjectionRun } from './final-message-projection'
import {
  createFinalMessageProjectionState,
  finalizeFinalMessageProjection,
  flushProjectedToolInputs,
  projectFinalMessageChunk,
} from './final-message-projection'
import { isTerminalUIMessageChunk, readTerminalStatus } from './stream-chunks'

interface ProviderSyntheticTurnState extends FinalMessageProjectionRun {
  providerTurnId: string
  providerThreadId: string | null
  runId: string | null
  sessionId: string
  messageId: string
  runtimeSession: RuntimeSession
  providerTargetId: string | null
  modelId: string | null
  terminalStatus?: TerminalChatMessageStatus
}

export function createProviderSyntheticTurnEventHandler(
  activeRun: ActiveRun,
): (event: ProviderSyntheticTurnEvent) => Promise<void> {
  const syntheticTurns = new Map<string, ProviderSyntheticTurnState>()

  return async (event) => {
    if (event.chunks.length === 0) {
      return
    }

    if (event.providerThreadId) {
      publishProviderThreadEvent({
        store: providerThreadStreamStore,
        sessionId: activeRun.sessionId,
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
        syntheticTurn = startProviderSyntheticTurn(activeRun, event)
        syntheticTurns.set(event.providerTurnId, syntheticTurn)
      }

      for (const chunk of event.chunks) {
        await applyProviderSyntheticTurnChunk(syntheticTurn, chunk)
        if (syntheticTurn.terminalStatus) {
          syntheticTurns.delete(event.providerTurnId)
          break
        }
      }
    }
 catch (error) {
      if (syntheticTurn && !syntheticTurn.terminalStatus) {
        syntheticTurns.delete(event.providerTurnId)
        await finalizeProviderSyntheticTurn(
          syntheticTurn,
          'failed',
          error instanceof Error ? error.message : String(error),
          { type: 'error', errorText: error instanceof Error ? error.message : String(error) },
        )
      }
      throw error
    }
  }
}

function startProviderSyntheticTurn(
  parentRun: ActiveRun,
  event: ProviderSyntheticTurnEvent,
): ProviderSyntheticTurnState {
  const messageId = randomUUID()
  const assistantMessage = createAssistantMessage(messageId)

  return {
    providerTurnId: event.providerTurnId,
    providerThreadId: event.providerThreadId ?? null,
    runId: null,
    sessionId: parentRun.sessionId,
    messageId,
    runtimeSession: parentRun.runtimeSession,
    providerTargetId: parentRun.providerTargetId,
    modelId: parentRun.modelId,
    finalMessage: assistantMessage,
    finalProjection: createFinalMessageProjectionState(),
  }
}

async function applyProviderSyntheticTurnChunk(
  syntheticTurn: ProviderSyntheticTurnState,
  chunk: UIMessageChunk,
): Promise<void> {
  if (syntheticTurn.terminalStatus) {
    return
  }

  if (!isTerminalUIMessageChunk(chunk)) {
    projectFinalMessageChunk(syntheticTurn, chunk)
    return
  }

  await finalizeProviderSyntheticTurn(
    syntheticTurn,
    readTerminalStatus(chunk),
    chunk.type === 'error' ? chunk.errorText : null,
    chunk,
  )
}

async function finalizeProviderSyntheticTurn(
  syntheticTurn: ProviderSyntheticTurnState,
  status: TerminalChatMessageStatus,
  errorText: string | null,
  terminalChunk: UIMessageChunk,
): Promise<void> {
  if (syntheticTurn.terminalStatus) {
    return
  }
  syntheticTurn.terminalStatus = status
  projectFinalMessageChunk(syntheticTurn, terminalChunk)
  finalizeFinalMessageProjection(syntheticTurn)
  await flushProjectedToolInputs(syntheticTurn)

  const bindingId = recordProviderSyntheticTurnBindingId(syntheticTurn)
  const now = currentUnixSeconds()
  const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(syntheticTurn.finalMessage))
  const messageJson = JSON.stringify(message)
  const run = {
    id: randomUUID(),
    bindingId: bindingId ?? null,
    chatSessionId: syntheticTurn.sessionId,
    messageId: syntheticTurn.messageId,
    origin: 'system',
    status: 'streaming',
    stopReason: null,
    errorText: null,
    startedAt: now,
    finishedAt: null,
  } satisfies BackendRunStartedFact
  syntheticTurn.runId = run.id
  await commitSessionEvents(syntheticTurn.sessionId, [
    {
      type: 'RunStarted',
      payload: {
        run,
        assistantMessage: {
          id: syntheticTurn.messageId,
          sessionId: syntheticTurn.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: extractMessageText(message),
          messageJson,
          errorText: null,
          createdAt: now,
          updatedAt: now,
        },
        queueItemId: null,
      },
    },
    {
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: syntheticTurn.messageId,
          sessionId: syntheticTurn.sessionId,
          content: extractMessageText(message),
          messageJson,
          status,
          errorText,
          updatedAt: now,
        },
      },
    },
    {
      type: readRunTerminalEventType(status),
      payload: {
        runId: run.id,
        sessionId: syntheticTurn.sessionId,
        queueItemId: null,
        ...(bindingId !== undefined ? { bindingId } : {}),
        status,
        stopReason: readRunStopReason(status),
        errorText,
        finishedAt: now,
      },
    },
  ])
}

function recordProviderSyntheticTurnBindingId(
  syntheticTurn: ProviderSyntheticTurnState,
): string | undefined {
  try {
    return attachBinding({
      sessionId: syntheticTurn.sessionId,
      providerTargetId: syntheticTurn.providerTargetId,
      runtimeKind: syntheticTurn.runtimeSession.runtimeKind,
      runtimeSession: syntheticTurn.runtimeSession,
      requestedModelId: syntheticTurn.modelId,
    })?.id
  }
 catch {
    return undefined
  }
}
