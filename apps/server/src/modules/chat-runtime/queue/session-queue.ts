import { chatSessionQueueItems } from '@cradle/db'
import type { FileUIPart, UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import type { ChatContextPart } from '../context-parts'
import type {
  ChatRuntimeSettings,
  ChatRuntimeSettingsPatch,
  ChatThinkingEffort,
} from '../runtime-provider-types'
import {
  DEFAULT_RUNTIME_SETTINGS,
  mergeRuntimeSettings,
  normalizeRuntimeAccessMode,
  normalizeRuntimeInteractionMode,
} from '../runtime-settings'

export type PersistedThinkingEffort = Extract<ChatThinkingEffort, 'low' | 'medium' | 'high' | 'xhigh'>
export type ChatSessionContinuationMode = 'queue' | 'steer'
export type ChatSessionQueueMode = 'queue'
export type ChatSessionQueueStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'

export interface ChatSessionQueueItemDto {
  id: string
  sessionId: string
  mode: ChatSessionQueueMode
  status: ChatSessionQueueStatus
  text: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: PersistedThinkingEffort | null
  runtimeSettings: ChatRuntimeSettings
  position: number
  sourceRunId: string | null
  startedRunId: string | null
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export interface EnqueueSessionQueueItemInput {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: PersistedThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
}

export interface UpdateSessionQueueItemInput extends EnqueueSessionQueueItemInput {
  queueItemId: string
}

export interface SubmitSessionSteerTurnInput {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  providerTargetId?: string
}

export interface SessionSteerTurnSteeredDto {
  mode: 'steered'
  ok: true
  sessionId: string
  runId: string
  sourceMessageId: string
  message: UIMessage
}

export interface SessionSteerTurnQueuedDto {
  mode: 'queued'
  ok: true
  sessionId: string
  queueItem: ChatSessionQueueItemDto
}

/**
 * Discriminated by `mode`: the server decides at request time (based on the target runtime's
 * `steer` capability and whether a matching active run exists) whether a steer request can be
 * live-steered or must fall back to queueing. Callers branch on `mode`, not on catching a
 * fallback-specific error code.
 */
export type SessionSteerTurnDto = SessionSteerTurnSteeredDto | SessionSteerTurnQueuedDto

type QueueItemRow = typeof chatSessionQueueItems.$inferSelect

export function parseQueueFiles(filesJson: string): FileUIPart[] {
  try {
    return JSON.parse(filesJson) as FileUIPart[]
  }
 catch (error) {
    throw new AppError({
      code: 'chat_queue_item_invalid',
      status: 500,
      message: 'Stored chat queue item is invalid',
      details: {
        reason: error instanceof Error ? error.message : 'Invalid file attachment payload',
      },
    })
  }
}

export function parseQueueContextParts(contextPartsJson: string): ChatContextPart[] {
  try {
    return JSON.parse(contextPartsJson) as ChatContextPart[]
  }
 catch (error) {
    throw new AppError({
      code: 'chat_queue_item_invalid',
      status: 500,
      message: 'Stored chat queue item is invalid',
      details: {
        reason: error instanceof Error ? error.message : 'Invalid context part payload',
      },
    })
  }
}

export function serializeQueueFiles(files: FileUIPart[]): string {
  return JSON.stringify(files)
}

export function serializeQueueContextParts(contextParts: ChatContextPart[]): string {
  return JSON.stringify(contextParts)
}

export function readQueueItemRuntimeSettings(
  row: Pick<QueueItemRow, 'permissionMode' | 'runtimeAccessMode' | 'runtimeInteractionMode'>,
  sessionRuntimeSettings: ChatRuntimeSettings,
): ChatRuntimeSettings {
  const accessMode
    = normalizeRuntimeAccessMode(row.runtimeAccessMode)
      ?? (row.permissionMode === 'plan' ? 'approval-required' : DEFAULT_RUNTIME_SETTINGS.accessMode)
  const interactionMode
    = normalizeRuntimeInteractionMode(row.runtimeInteractionMode)
      ?? (row.permissionMode === 'plan' ? 'plan' : DEFAULT_RUNTIME_SETTINGS.interactionMode)
  return mergeRuntimeSettings(sessionRuntimeSettings, {
    accessMode,
    interactionMode,
  })
}

export function readPersistedThinkingEffort(effort: unknown): PersistedThinkingEffort | null {
  return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
    ? effort
    : null
}

export function toQueueItemDto(
  row: QueueItemRow,
  sessionRuntimeSettings: ChatRuntimeSettings = DEFAULT_RUNTIME_SETTINGS,
): ChatSessionQueueItemDto {
  const runtimeSettings = readQueueItemRuntimeSettings(row, sessionRuntimeSettings)
  return {
    id: row.id,
    sessionId: row.sessionId,
    mode: row.mode as ChatSessionQueueMode,
    status: row.status as ChatSessionQueueStatus,
    text: row.text,
    files: parseQueueFiles(row.filesJson),
    contextParts: parseQueueContextParts(row.contextPartsJson),
    providerTargetId: row.providerTargetId,
    modelId: row.modelId,
    thinkingEffort: readPersistedThinkingEffort(row.thinkingEffort),
    runtimeSettings,
    position: row.position,
    sourceRunId: row.sourceRunId,
    startedRunId: row.startedRunId,
    errorText: row.errorText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function compareQueueRows(left: QueueItemRow, right: QueueItemRow): number {
  const statusRank: Record<string, number> = {
    running: 0,
    pending: 1,
    completed: 2,
    cancelled: 2,
    failed: 2,
  }
  const leftRank = statusRank[left.status] ?? 3
  const rightRank = statusRank[right.status] ?? 3
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }
  if (left.status === 'running' || left.status === 'pending') {
    return left.position - right.position || left.createdAt - right.createdAt
  }
  return right.createdAt - left.createdAt || right.updatedAt - left.updatedAt
}

export function listPendingQueueRows(sessionId: string): QueueItemRow[] {
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        eq(chatSessionQueueItems.status, 'pending'),
      ),
    )
    .orderBy(chatSessionQueueItems.position, chatSessionQueueItems.createdAt)
    .all()
}
