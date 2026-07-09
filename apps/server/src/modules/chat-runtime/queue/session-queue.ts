import { chatSessionQueueItems } from '@cradle/db'
import type { FileUIPart, UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import type { RuntimeKind } from '../../provider-contracts/types'
import type { ChatContextPart } from '../context-parts'
import type {
  ChatThinkingEffort,
  RuntimeSettings,
  RuntimeSettingsPatch,
} from '../runtime-provider-types'
import {
  getDefaultRuntimeSettings,
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
} from '../runtime-settings'

export type PersistedThinkingEffort = ChatThinkingEffort
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
  runtimeSettings: RuntimeSettings
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
  runtimeSettings?: RuntimeSettingsPatch
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

export function serializeQueueRuntimeSettings(
  runtimeKind: RuntimeKind,
  settings: RuntimeSettings,
): string {
  return JSON.stringify(mergeRuntimeSettings(runtimeKind, getDefaultRuntimeSettings(runtimeKind), settings))
}

type LegacyQueueItemRuntimeFields = {
  permissionMode?: 'bypassPermissions' | 'plan' | null
  runtimeAccessMode?: 'approval-required' | 'full-access' | null
  runtimeInteractionMode?: 'default' | 'plan' | null
}

/** Normalize queue item facts from legacy ES payloads into `runtime_settings_json`. */
export function normalizeQueueItemRuntimeSettingsJson(
  item: { runtimeSettingsJson?: string } & LegacyQueueItemRuntimeFields,
): string {
  if (typeof item.runtimeSettingsJson === 'string' && item.runtimeSettingsJson.length > 0) {
    return item.runtimeSettingsJson
  }
  const settings: RuntimeSettings = {}
  if (item.permissionMode === 'plan') {
    settings.permissionMode = 'plan'
  }
  if (item.runtimeAccessMode === 'approval-required' || item.runtimeAccessMode === 'full-access') {
    settings.accessMode = item.runtimeAccessMode
  }
  if (item.runtimeInteractionMode === 'plan') {
    settings.interactionMode = 'plan'
    if (!settings.permissionMode) {
      settings.permissionMode = 'plan'
    }
  }
  else if (item.runtimeInteractionMode === 'default') {
    settings.interactionMode = 'default'
  }
  if (Object.keys(settings).length === 0) {
    return '{}'
  }
  return JSON.stringify(settings)
}

export function projectQueueItemFactRow(
  item: QueueItemRow | (Omit<QueueItemRow, 'runtimeSettingsJson'> & LegacyQueueItemRuntimeFields & { runtimeSettingsJson?: string }),
): QueueItemRow {
  return {
    ...item,
    runtimeSettingsJson: normalizeQueueItemRuntimeSettingsJson(item),
  } as QueueItemRow
}

export function parseQueueRuntimeSettings(
  runtimeKind: RuntimeKind,
  runtimeSettingsJson: string,
): RuntimeSettings {
  try {
    const parsed = JSON.parse(runtimeSettingsJson) as unknown
    return mergeRuntimeSettings(runtimeKind, getDefaultRuntimeSettings(runtimeKind), normalizeRuntimeSettingsPatch(runtimeKind, parsed))
  }
  catch {
    return getDefaultRuntimeSettings(runtimeKind)
  }
}

export function readQueueItemRuntimeSettings(
  runtimeKind: RuntimeKind,
  row: Pick<QueueItemRow, 'runtimeSettingsJson'>,
): RuntimeSettings {
  return parseQueueRuntimeSettings(runtimeKind, row.runtimeSettingsJson)
}

export function readPersistedThinkingEffort(effort: unknown): PersistedThinkingEffort | null {
  return effort === 'none'
    || effort === 'minimal'
    || effort === 'low'
    || effort === 'medium'
    || effort === 'high'
    || effort === 'xhigh'
    || effort === 'max'
    ? effort
    : null
}

export function toQueueItemDto(
  runtimeKind: RuntimeKind,
  row: QueueItemRow,
): ChatSessionQueueItemDto {
  const runtimeSettings = readQueueItemRuntimeSettings(runtimeKind, row)
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
    .all()
    .sort(compareQueueRows)
}
