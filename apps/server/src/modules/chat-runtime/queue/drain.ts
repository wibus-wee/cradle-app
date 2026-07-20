import type { FileUIPart } from 'ai'

import { AppError } from '../../../errors/app-error'
import type { ChatContextPart } from '../context-parts'
import {
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

/**
 * Brief settle so a post-result separate-turn can clear mid-turn absorption
 * before we complete the queue item without a run. Claude's mid-turn
 * `queued_command` path never produces that output; the separate-turn path
 * usually buffers within this window.
 */
const MID_TURN_ABSORPTION_SETTLE_MS = 150

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
  try {
    await recoverOrphanedQueueItemClaims(sessionId)
    while (!deps.hasActiveOrPendingRun(sessionId)) {
      const next = listPendingQueueRows(sessionId).sort(compareQueueRows)[0]
      if (!next) {
        return
      }

      // Claude Agent may fold a live native follow-up into the previous turn as
      // mid-turn `queued_command`. Result-time absorption is tentative; wait briefly
      // so a true separate-turn can clear it, then complete without an empty run.
      if (liveRuntimeSessionRegistry.isNativeFollowUpAbsorbedMidTurn(sessionId, next.id)) {
        await sleep(MID_TURN_ABSORPTION_SETTLE_MS)
        if (
          !deps.hasActiveOrPendingRun(sessionId)
          && liveRuntimeSessionRegistry.isNativeFollowUpAbsorbedMidTurn(sessionId, next.id)
        ) {
          try {
            await completeAbsorbedMidTurnQueueItem(sessionId, next)
            liveRuntimeSessionRegistry.consumeNativeFollowUpAbsorbedMidTurn(sessionId, next.id)
            await normalizeSessionQueuePositions(sessionId)
            continue
          }
          catch (error) {
            await failClaimedQueueItem(sessionId, next.id, deps.serializeError(error).text)
            await normalizeSessionQueuePositions(sessionId)
            continue
          }
        }
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
      || (!deps.hasActiveOrPendingRun(sessionId) && listPendingQueueRows(sessionId).length > 0)
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

async function completeAbsorbedMidTurnQueueItem(
  sessionId: string,
  row: ReturnType<typeof listPendingQueueRows>[number],
): Promise<void> {
  // Persist the user bubble without starting a Cradle run — the previous live turn
  // already produced the assistant answer. Product semantics are steer (mid-turn
  // fold into the active turn), even when the entry arrived via the durable queue.
  const draft = createDraftTurn({
    sessionId,
    userText: row.text,
    files: parseQueueFiles(row.filesJson),
    contextParts: parseQueueContextParts(row.contextPartsJson),
    continuation: { mode: 'steer', queueItemId: row.id },
  })
  await appendDraftUserMessage({ sessionId, userMessage: draft.userMessage })
  await completeSessionQueueItem(sessionId, row.id, {
    absorbedByRunId: row.sourceRunId,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
