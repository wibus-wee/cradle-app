import type { FileUIPart } from 'ai'

import { AppError } from '../../../errors/app-error'
import type { ChatContextPart } from '../context-parts'
import {
  cancelQueuedSessionItem,
  claimSessionQueueItem,
  completeSessionQueueItem,
  failSessionQueueItem,
  normalizeSessionQueuePositions,
  recoverOrphanedQueueItemClaims,
  releaseSessionQueueItem,
} from '../es/commands'
import type { SerializedChatError } from '../run/errors'
import { appendDraftUserMessage, createDraftTurn } from '../run/turn-draft'
import { liveRuntimeSessionRegistry } from '../runtime-live-session-registry'
import type { RuntimeSettings } from '../runtime-provider-types'
import { assertStoredSession } from '../runtime-session-context'
import type { PersistedThinkingEffort } from './session-queue'
import {
  compareQueueRows,
  listPendingQueueRows,
  parseQueueContextParts,
  parseQueueFiles,
  readPersistedThinkingEffort,
  readQueueItemRuntimeSettings,
} from './session-queue'

const drainingSessionIds = new Set<string>()
const requestedDrainSessionIds = new Set<string>()

export interface QueueDrainDeps {
  hasActiveOrPendingRun: (sessionId: string) => boolean
  readSessionRuntimeSettings: (sessionId: string) => RuntimeSettings
  createQueuedRun: (input: {
    sessionId: string
    text: string
    files: FileUIPart[]
    contextParts: ChatContextPart[]
    providerTargetId?: string
    modelId?: string
    thinkingEffort?: PersistedThinkingEffort
    runtimeSettings: RuntimeSettings
    queueItemId: string
    continuationMode: 'queue' | 'steer'
  }) => Promise<{ runId: string }>
  serializeError: (error: unknown) => SerializedChatError
}

export function scheduleSessionQueueDrain(sessionId: string, deps: QueueDrainDeps): void {
  if (drainingSessionIds.has(sessionId)) {
    requestedDrainSessionIds.add(sessionId)
    return
  }

  requestedDrainSessionIds.add(sessionId)
  queueMicrotask(() => {
    void drainSessionQueue(sessionId, deps)
  })
}

async function drainSessionQueue(sessionId: string, deps: QueueDrainDeps): Promise<void> {
  if (drainingSessionIds.has(sessionId)) {
    requestedDrainSessionIds.add(sessionId)
    return
  }
  if (deps.hasActiveOrPendingRun(sessionId)) {
    return
  }

  drainingSessionIds.add(sessionId)
  requestedDrainSessionIds.delete(sessionId)
  let waitingForNativeInput = false
  try {
    await recoverOrphanedQueueItemClaims(sessionId)
    while (!deps.hasActiveOrPendingRun(sessionId)) {
      const next = listPendingQueueRows(sessionId).sort(compareQueueRows)[0]
      if (!next) {
        return
      }

      const nativeOutcome = liveRuntimeSessionRegistry.consumeTerminalNativeInput(
        sessionId,
        next.id,
      )
      if (nativeOutcome) {
        try {
          if (nativeOutcome === 'completed') {
            await completeSubmittedNativeQueueItem(sessionId, next)
          }
          else if (nativeOutcome === 'failed') {
            await failClaimedQueueItem(
              sessionId,
              next.id,
              'Claude native input failed before a completed lifecycle fact',
            )
          }
          else {
            await cancelQueuedSessionItem(sessionId, next.id)
          }
          await normalizeSessionQueuePositions(sessionId)
          continue
        }
        catch (error) {
          await failClaimedQueueItem(sessionId, next.id, deps.serializeError(error).text)
          await normalizeSessionQueuePositions(sessionId)
          continue
        }
      }

      // The input was already pushed into the provider's long-lived native queue.
      // Wait for an exact command lifecycle terminal fact; never start a second run
      // to claim or re-submit it.
      const live = liveRuntimeSessionRegistry.read(sessionId)
      if (live?.hasNativeInput?.(next.id)) {
        waitingForNativeInput = true
        return
      }

      const claimed = await claimQueueItem(sessionId, next.id)
      if (!claimed) {
        continue
      }

      try {
        const session = assertStoredSession(sessionId)
        const runtimeKind = session.runtimeKind ?? 'standard'
        const runtimeSettings = readQueueItemRuntimeSettings(runtimeKind, claimed)
        await deps.createQueuedRun({
          sessionId,
          text: claimed.text,
          files: parseQueueFiles(claimed.filesJson),
          contextParts: parseQueueContextParts(claimed.contextPartsJson),
          providerTargetId: claimed.providerTargetId ?? undefined,
          modelId: claimed.modelId ?? undefined,
          thinkingEffort: readPersistedThinkingEffort(claimed.thinkingEffort) ?? undefined,
          runtimeSettings,
          queueItemId: claimed.id,
          continuationMode: claimed.mode === 'steer' ? 'steer' : 'queue',
        })
        await normalizeSessionQueuePositions(sessionId)
        return
      }
      catch (error) {
        if (error instanceof AppError && error.code === 'chat_run_cancelled') {
          await normalizeSessionQueuePositions(sessionId)
          return
        }

        if (isDeferredQueueDrainError(error)) {
          await releaseClaimedQueueItem(sessionId, claimed.id)
          return
        }

        await failClaimedQueueItem(sessionId, claimed.id, deps.serializeError(error).text)
        await normalizeSessionQueuePositions(sessionId)
      }
    }
  }
  finally {
    drainingSessionIds.delete(sessionId)
    if (
      requestedDrainSessionIds.delete(sessionId)
      || (
        !waitingForNativeInput
        && !deps.hasActiveOrPendingRun(sessionId)
        && listPendingQueueRows(sessionId).length > 0
      )
    ) {
      scheduleSessionQueueDrain(sessionId, deps)
    }
  }
}

export function isDeferredQueueDrainError(error: unknown): boolean {
  return error instanceof AppError
    && (
      error.code === 'chat_run_in_progress'
      || error.code === 'chat_session_maintenance_in_progress'
    )
}

async function completeSubmittedNativeQueueItem(
  sessionId: string,
  row: ReturnType<typeof listPendingQueueRows>[number],
): Promise<void> {
  // Persist the submitted input without inventing a one-item Cradle execution.
  // The provider's exact command UUID lifecycle completed natively already.
  const draft = createDraftTurn({
    sessionId,
    userText: row.text,
    files: parseQueueFiles(row.filesJson),
    contextParts: parseQueueContextParts(row.contextPartsJson),
    continuation: {
      mode: row.mode === 'steer' ? 'steer' : 'queue',
      queueItemId: row.id,
    },
  })
  await appendDraftUserMessage({ sessionId, userMessage: draft.userMessage })
  await completeSessionQueueItem(sessionId, row.id)
}

async function claimQueueItem(sessionId: string, queueItemId: string) {
  return await claimSessionQueueItem(sessionId, queueItemId)
}

async function releaseClaimedQueueItem(sessionId: string, queueItemId: string): Promise<void> {
  await releaseSessionQueueItem(sessionId, queueItemId)
}

async function failClaimedQueueItem(
  sessionId: string,
  queueItemId: string,
  errorText: string,
): Promise<void> {
  await failSessionQueueItem(sessionId, queueItemId, errorText)
}
