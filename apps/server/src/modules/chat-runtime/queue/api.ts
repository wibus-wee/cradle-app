import { randomUUID } from 'node:crypto'

import { chatSessionQueueItems } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import {
  cancelQueuedSessionItem,
  commitSessionEvents,
  normalizeSessionQueuePositions,
  recordQueuePositions
} from '../es/commands'
import {
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  readSessionRuntimeSettings
} from '../runtime-settings'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  assertStoredSession,
  getSessionRunContext
} from '../runtime-session-context'
import { runRegistry } from '../run-registry'
import type {
  ChatSessionQueueItemDto,
  EnqueueSessionQueueItemInput,
  UpdateSessionQueueItemInput
} from './session-queue'
import {
  compareQueueRows,
  listPendingQueueRows,
  readPersistedThinkingEffort,
  serializeQueueContextParts,
  serializeQueueFiles,
  toQueueItemDto
} from './session-queue'

export interface SessionQueueApiDeps {
  finalizeInterruptedPersistedStreamingSessionIfIdle: (sessionId: string) => Promise<void>
  scheduleSessionQueueDrain: (sessionId: string) => void
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()
    .sort(compareQueueRows)
    .map((row) => toQueueItemDto(row, runtimeSettings))
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput,
  deps: SessionQueueApiDeps
): Promise<ChatSessionQueueItemDto> {
  await deps.finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)
  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  const pendingRows = listPendingQueueRows(input.sessionId)
  const position =
    pendingRows.reduce((maxPosition, row) => Math.max(maxPosition, row.position), 0) + 1
  const now = currentUnixSeconds()
  const baseRuntimeSettings = readSessionRuntimeSettings(context.session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    baseRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const row = {
    id: randomUUID(),
    sessionId: input.sessionId,
    mode: 'queue' as const,
    status: 'pending' as const,
    text,
    filesJson: serializeQueueFiles(files),
    contextPartsJson: serializeQueueContextParts(contextParts),
    providerTargetId: input.providerTargetId?.trim() || null,
    modelId: input.modelId?.trim() || null,
    thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
    permissionMode: null,
    runtimeAccessMode: runtimeSettings.accessMode,
    runtimeInteractionMode: runtimeSettings.interactionMode,
    position,
    sourceRunId: runRegistry.getActiveRunIdForSession(input.sessionId) ?? null,
    startedRunId: null,
    errorText: null,
    createdAt: now,
    updatedAt: now
  }
  await commitSessionEvents(input.sessionId, [
    {
      type: 'QueueItemEnqueued',
      payload: { item: row }
    }
  ])

  deps.scheduleSessionQueueDrain(input.sessionId)
  return toQueueItemDto(row, runtimeSettings)
}

export async function cancelSessionQueueItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItemDto> {
  assertRunnableSession(sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId, queueItemId }
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: row.status }
    })
  }

  const updated = await cancelQueuedSessionItem(sessionId, queueItemId)
  if (!updated || updated.status !== 'cancelled') {
    const current = db()
      .select()
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.id, queueItemId),
          eq(chatSessionQueueItems.sessionId, sessionId),
          eq(chatSessionQueueItems.mode, 'queue')
        )
      )
      .get()
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: current?.status ?? 'missing' }
    })
  }
  await normalizeSessionQueuePositions(sessionId)
  return toQueueItemDto(updated)
}

export async function reorderSessionQueueItems(
  sessionId: string,
  queueItemIds: string[]
): Promise<ChatSessionQueueItemDto[]> {
  assertRunnableSession(sessionId)
  const pendingRows = listPendingQueueRows(sessionId)
  const pendingIds = pendingRows.map((row) => row.id)
  const requestedIds = new Set(queueItemIds)
  const pendingIdSet = new Set(pendingIds)
  const hasSameItems =
    queueItemIds.length === pendingIds.length &&
    queueItemIds.every((id) => pendingIdSet.has(id)) &&
    pendingIds.every((id) => requestedIds.has(id))
  if (!hasSameItems) {
    throw new AppError({
      code: 'chat_queue_reorder_invalid',
      status: 400,
      message: 'Queue reorder must include every pending chat queue item exactly once',
      details: { sessionId, pendingIds, queueItemIds }
    })
  }

  const rowsById = new Map(pendingRows.map((row) => [row.id, row]))
  await recordQueuePositions(
    sessionId,
    queueItemIds
      .map((queueItemId) => rowsById.get(queueItemId))
      .filter((row): row is (typeof pendingRows)[number] => Boolean(row))
  )

  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return listPendingQueueRows(sessionId).map((row) => toQueueItemDto(row, runtimeSettings))
}

export async function updateSessionQueueItem(
  input: UpdateSessionQueueItemInput
): Promise<ChatSessionQueueItemDto> {
  assertRunnableSession(input.sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId }
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be edited',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId, status: row.status }
    })
  }

  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId }
    })
  }

  const session = assertStoredSession(input.sessionId)
  const baseRuntimeSettings = readSessionRuntimeSettings(session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    baseRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const now = currentUnixSeconds()
  await commitSessionEvents(input.sessionId, [
    {
      type: 'QueueItemUpdated',
      payload: {
        queueItemId: input.queueItemId,
        sessionId: input.sessionId,
        text,
        filesJson: serializeQueueFiles(files),
        contextPartsJson: serializeQueueContextParts(contextParts),
        providerTargetId: input.providerTargetId?.trim() || null,
        modelId: input.modelId?.trim() || null,
        thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
        runtimeAccessMode: runtimeSettings.accessMode,
        runtimeInteractionMode: runtimeSettings.interactionMode,
        updatedAt: now
      }
    }
  ])

  const updatedRow = db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.id, input.queueItemId))
    .get()
  return toQueueItemDto(updatedRow ?? row, runtimeSettings)
}
