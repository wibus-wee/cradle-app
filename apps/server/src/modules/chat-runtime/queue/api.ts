import { randomUUID } from 'node:crypto'

import { chatSessionQueueItems } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { runtimeOwnsProviderTarget } from '../../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../../provider-contracts/types'
import {
  cancelQueuedSessionItem,
  commitSessionEvents,
  normalizeSessionQueuePositions,
  recordQueuePositions,
} from '../es/commands'
import { runRegistry } from '../run-registry'
import { liveRuntimeSessionRegistry } from '../runtime-live-session-registry'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  assertStoredSession,
  getSessionRunContext,
} from '../runtime-session-context'
import {
  readSessionRuntimeSettings,
  resolveRunRuntimeSettings,
} from '../runtime-settings'
import type {
  ChatSessionQueueItemDto,
  EnqueueSessionQueueItemInput,
  UpdateSessionQueueItemInput,
} from './session-queue'
import {
  compareQueueRows,
  listPendingQueueRows,
  readPersistedThinkingEffort,
  serializeQueueContextParts,
  serializeQueueFiles,
  serializeQueueRuntimeSettings,
  toQueueItemDto,
} from './session-queue'

export interface SessionQueueApiDeps {
  scheduleSessionQueueDrain: (sessionId: string) => void
}

function readSessionRuntimeKind(session: { runtimeKind: RuntimeKind | null }): RuntimeKind {
  return session.runtimeKind ?? 'standard'
}

function readPersistedQueueProviderTargetId(input: {
  providerTargetId: string | null | undefined
  runtimeKind: string | null | undefined
}): string | null {
  const providerTargetId = input.providerTargetId?.trim() || null
  if (
    providerTargetId
    && runtimeOwnsProviderTarget(input.runtimeKind ?? 'standard', providerTargetId)
  ) {
    return null
  }
  return providerTargetId
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  const session = assertStoredSession(sessionId)
  const runtimeKind = readSessionRuntimeKind(session)
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId)),
    )
    .all()
    .sort(compareQueueRows)
    .map(row => toQueueItemDto(runtimeKind, row))
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput,
  deps: SessionQueueApiDeps,
): Promise<ChatSessionQueueItemDto> {
  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId,
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId },
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
      details: { sessionId: input.sessionId },
    })
  }

  const pendingRows = listPendingQueueRows(input.sessionId)
  const mode = input.mode === 'steer' ? 'steer' as const : 'queue' as const
  const position = input.placement === 'front' && pendingRows.length > 0
    ? Math.min(...pendingRows.map(row => row.position)) - 1
    : pendingRows.reduce((maxPosition, row) => Math.max(maxPosition, row.position), 0) + 1
  const now = currentUnixSeconds()
  const runtimeKind = readSessionRuntimeKind(context.session)
  const baseRuntimeSettings = readSessionRuntimeSettings(runtimeKind, context.session.configJson)
  const runtimeSettings = resolveRunRuntimeSettings(
    runtimeKind,
    baseRuntimeSettings,
    input.runtimeSettings,
  )
  const providerTargetId = readPersistedQueueProviderTargetId({
    providerTargetId: input.providerTargetId,
    runtimeKind: context.session.runtimeKind,
  })
  const row = {
    id: randomUUID(),
    sessionId: input.sessionId,
    mode,
    status: 'pending' as const,
    text,
    filesJson: serializeQueueFiles(files),
    contextPartsJson: serializeQueueContextParts(contextParts),
    providerTargetId,
    modelId: input.modelId?.trim() || null,
    thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
    runtimeSettingsJson: serializeQueueRuntimeSettings(runtimeKind, runtimeSettings),
    position,
    sourceRunId: runRegistry.getActiveRunIdForSession(input.sessionId) ?? null,
    startedRunId: null,
    errorText: null,
    createdAt: now,
    updatedAt: now,
  }

  // Synara-aligned durable queue: never mid-turn push into a live provider input stream.
  // Composer Enter=queue and Cmd+Enter steer both wait for the active turn to settle (steer also
  // interrupts), then drain creates a new run. Low-level Claude native UUID helpers remain on the
  // live registry for tests / explicit cancel, but enqueue does not call them.

  await commitSessionEvents(input.sessionId, [
    {
      type: 'QueueItemEnqueued',
      payload: { item: row },
    },
  ])

  deps.scheduleSessionQueueDrain(input.sessionId)
  return toQueueItemDto(runtimeKind, row)
}

export async function cancelSessionQueueItem(
  sessionId: string,
  queueItemId: string,
): Promise<ChatSessionQueueItemDto> {
  assertRunnableSession(sessionId)
  const session = assertStoredSession(sessionId)
  const runtimeKind = readSessionRuntimeKind(session)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
              ),
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId, queueItemId },
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: row.status },
    })
  }

  const nativeOutcome = liveRuntimeSessionRegistry.readTerminalNativeInput(sessionId, queueItemId)
  if (nativeOutcome) {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Queue item already reached a terminal state in the native runtime',
      details: { sessionId, queueItemId, status: nativeOutcome },
    })
  }

  const live = liveRuntimeSessionRegistry.read(sessionId)
  if (live?.hasNativeInput?.(queueItemId)) {
    let cancelled = false
    try {
      cancelled = await live.cancelNativeInput?.(queueItemId) ?? false
    }
    catch (error) {
      throw new AppError({
        code: 'chat_queue_native_cancel_failed',
        status: 409,
        message: 'Native runtime did not cancel the submitted queue item',
        details: {
          sessionId,
          queueItemId,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
    if (!cancelled) {
      throw new AppError({
        code: 'chat_queue_native_cancel_failed',
        status: 409,
        message: 'Native runtime did not cancel the submitted queue item',
        details: { sessionId, queueItemId },
      })
    }
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
                  ),
      )
      .get()
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: current?.status ?? 'missing' },
    })
  }
  await normalizeSessionQueuePositions(sessionId)
  return toQueueItemDto(runtimeKind, updated)
}

export async function reorderSessionQueueItems(
  sessionId: string,
  queueItemIds: string[],
): Promise<ChatSessionQueueItemDto[]> {
  assertRunnableSession(sessionId)
  const session = assertStoredSession(sessionId)
  const runtimeKind = readSessionRuntimeKind(session)
  const pendingRows = listPendingQueueRows(sessionId)
  const pendingIds = pendingRows.map(row => row.id)
  const requestedIds = new Set(queueItemIds)
  const pendingIdSet = new Set(pendingIds)
  const hasSameItems
    = queueItemIds.length === pendingIds.length
      && queueItemIds.every(id => pendingIdSet.has(id))
      && pendingIds.every(id => requestedIds.has(id))
  if (!hasSameItems) {
    throw new AppError({
      code: 'chat_queue_reorder_invalid',
      status: 400,
      message: 'Queue reorder must include every pending chat queue item exactly once',
      details: { sessionId, pendingIds, queueItemIds },
    })
  }

  const rowsById = new Map(pendingRows.map(row => [row.id, row]))
  await recordQueuePositions(
    sessionId,
    queueItemIds
      .map(queueItemId => rowsById.get(queueItemId))
      .filter((row): row is (typeof pendingRows)[number] => Boolean(row)),
  )

  return listPendingQueueRows(sessionId).map(row => toQueueItemDto(runtimeKind, row))
}

export async function updateSessionQueueItem(
  input: UpdateSessionQueueItemInput,
): Promise<ChatSessionQueueItemDto> {
  assertRunnableSession(input.sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
              ),
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId },
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be edited',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId, status: row.status },
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
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId },
    })
  }

  const session = assertStoredSession(input.sessionId)
  const runtimeKind = readSessionRuntimeKind(session)
  const baseRuntimeSettings = readSessionRuntimeSettings(runtimeKind, session.configJson)
  const runtimeSettings = resolveRunRuntimeSettings(
    runtimeKind,
    baseRuntimeSettings,
    input.runtimeSettings,
  )
  const providerTargetId = readPersistedQueueProviderTargetId({
    providerTargetId: input.providerTargetId,
    runtimeKind: session.runtimeKind,
  })
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
        providerTargetId,
        modelId: input.modelId?.trim() || null,
        thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
        runtimeSettingsJson: serializeQueueRuntimeSettings(runtimeKind, runtimeSettings),
        updatedAt: now,
      },
    },
  ])

  const updatedRow = db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.id, input.queueItemId))
    .get()
  return toQueueItemDto(runtimeKind, updatedRow ?? row)
}
