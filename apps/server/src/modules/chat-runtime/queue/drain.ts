import type { FileUIPart } from 'ai'

import { AppError } from '../../../errors/app-error'
import type { ChatContextPart } from '../context-parts'
import {
  claimSessionQueueItem,
  failSessionQueueItem,
  normalizeSessionQueuePositions,
  recoverOrphanedQueueItemClaims,
  releaseSessionQueueItem,
} from '../es/commands'
import type { SerializedChatError } from '../run/errors'
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

        if (error instanceof AppError && error.code === 'chat_run_in_progress') {
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
