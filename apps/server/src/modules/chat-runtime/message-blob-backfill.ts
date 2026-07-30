import {
  readLegacyTruncatedPayload,
} from '@cradle/chat-runtime-contracts'
import {
  blobs,
  chatMessagePayloads,
  databaseMaintenanceTasks,
  messages,
} from '@cradle/db'
import type { UIMessage } from 'ai'
import {
  and,
  asc,
  eq,
  gt,
  like,
  lte,
  max,
  or,
  sql,
} from 'drizzle-orm'

import { readPositiveIntegerEnv } from '../../helpers/env'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { BlobStoreWriteHandle } from '../blob-store/service'
import type { MaintenanceResult, MaintenanceRunContext } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'
import { externalizeMessageBlobs } from './message-blob-externalization'
import { updateMessagePayload } from './message-payload-store'
import { extractMessageText } from './ui-message'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
/** Well above Maintenance's 30s default so a large batch is not aborted mid-pass. */
const DEFAULT_MAX_RUN_MS = 5 * 60 * 1000
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_MIN_ROW_CHARS = 64_000
const DEFAULT_STORED_TOOL_PREVIEW_MAX_CHARS = 4096

/**
 * One-shot sweep cursor in `database_maintenance_tasks`. Not a boot-time
 * migration — an 868 MB rewrite must not block startup — but the same table
 * shape as `compact-chat-storage-v1` for pending | completed + detailJson.
 */
export const CHAT_BLOB_BACKFILL_TASK_ID = 'chat-blob-backfill-v1'

interface BackfillSweepDetail {
  /** Last fully processed payload id; empty string means start of the sweep. */
  cursorPayloadId: string
  /**
   * Lexicographic max(id) captured when the sweep began. Rows with id above
   * this bound were written through the live externalization seam and need
   * no backfill.
   */
  maxPayloadIdAtStart: string | null
}

/**
 * Rewrite existing chat_message_payloads rows that still hold inline attachment
 * bytes or oversized tool payloads into content-addressed blob references.
 *
 * Legacy rows whose tool payload was already destroyed by
 * `cradle.truncated-json-payload` cannot be recovered — those bytes exist
 * nowhere. The backfill shrinks their oversized `preview` in place (keeping
 * `type` and `originalChars`) so the renderer still reports the true original
 * size; that reshaping is a migration concern and does not go through
 * `externalizeMessageBlobs`, which correctly refuses to touch legacy markers.
 *
 * The sweep is terminating: it walks matching rows by `id` ascending up to the
 * max id recorded at start, persists the cursor in `database_maintenance_tasks`,
 * and no-ops once that row is `completed`.
 */
export async function backfillMessageBlobs(
  context: Pick<MaintenanceRunContext, 'deadline' | 'report'>,
): Promise<MaintenanceResult> {
  const batchSize = readPositiveIntegerEnv('CRADLE_CHAT_BLOB_BACKFILL_BATCH', DEFAULT_BATCH_SIZE)
  const minRowChars = readPositiveIntegerEnv(
    'CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS',
    DEFAULT_MIN_ROW_CHARS,
  )
  const previewChars = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS',
    DEFAULT_STORED_TOOL_PREVIEW_MAX_CHARS,
  )

  const task = ensureBackfillTask()
  if (task.status === 'completed') {
    return emptyResult()
  }

  let detail = readSweepDetail(task.detailJson)
  if (detail.maxPayloadIdAtStart === null) {
    const maxId = readMaxPayloadId()
    if (maxId === null) {
      completeBackfillTask(detail)
      return emptyResult()
    }
    detail = {
      ...detail,
      maxPayloadIdAtStart: maxId,
    }
    persistSweepDetail(detail)
  }

  const maxPayloadIdAtStart = detail.maxPayloadIdAtStart
  if (maxPayloadIdAtStart === null) {
    completeBackfillTask(detail)
    return emptyResult()
  }

  let rowsScanned = 0
  let rowsRewritten = 0
  let blobsWritten = 0
  let bytesReclaimed = 0
  let rowsSkipped = 0
  let cursorPayloadId = detail.cursorPayloadId

  while (Date.now() < context.deadline) {
    const batch = selectBackfillBatch({
      batchSize,
      minRowChars,
      cursorPayloadId,
      maxPayloadIdAtStart,
    })
    if (batch.length === 0) {
      completeBackfillTask({
        cursorPayloadId,
        maxPayloadIdAtStart,
      })
      break
    }

    for (const row of batch) {
      if (Date.now() >= context.deadline) {
        break
      }

      rowsScanned += 1
      cursorPayloadId = row.payloadId

      let parsed: UIMessage
      try {
        parsed = JSON.parse(row.messageJson) as UIMessage
      }
      catch {
        rowsSkipped += 1
        continue
      }

      // Prefer the joined messages.id for refs — do not assume payloadId ===
      // messages.id even though every current writer uses that identity.
      const message: UIMessage = parsed.id === row.messageId
        ? parsed
        : { ...parsed, id: row.messageId }

      const shrunk = shrinkLegacyTruncationMarkers(message, previewChars)

      const rewrite = db().transaction((tx) => {
        const blobsBefore = countBlobs(tx)
        const next = externalizeMessageBlobs({
          sessionId: row.sessionId,
          message: shrunk,
          d: tx,
        })
        if (next === message) {
          return null
        }

        const messageJson = JSON.stringify(next)
        updateMessagePayload(tx, {
          id: row.payloadId,
          sessionId: row.sessionId,
          content: extractMessageText(next),
          messageJson,
          errorText: row.errorText,
          updatedAt: currentUnixSeconds(),
        })
        return {
          blobsWritten: countBlobs(tx) - blobsBefore,
          messageJson,
        }
      })
      if (!rewrite) {
        continue
      }

      rowsRewritten += 1
      blobsWritten += rewrite.blobsWritten
      bytesReclaimed += Math.max(0, row.messageJson.length - rewrite.messageJson.length)
    }

    persistSweepDetail({
      cursorPayloadId,
      maxPayloadIdAtStart,
    })

    context.report({
      rowsScanned,
      rowsRewritten,
      blobsWritten,
      bytesReclaimed,
      rowsSkipped,
    })
  }

  return {
    rowsScanned,
    rowsRewritten,
    blobsWritten,
    bytesReclaimed,
    rowsSkipped,
  }
}

export function registerMessageBlobBackfillMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'chat-runtime',
    key: 'backfill-message-blobs',
    title: 'Backfill message blobs',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    maxRunMs: DEFAULT_MAX_RUN_MS,
    run: context => backfillMessageBlobs(context),
  })
}

/**
 * Migration-only reshape: cut oversized legacy truncation previews down to the
 * live preview budget. Keeps `type` and `originalChars` so the renderer still
 * reports the true original size and that the remainder is unavailable.
 * Produces no blob — the destroyed tail exists nowhere.
 */
function shrinkLegacyTruncationMarkers(
  message: UIMessage,
  previewChars: number,
): UIMessage {
  let changed = false
  const parts = message.parts.map((part) => {
    if (!('toolCallId' in part)) {
      return part
    }

    let nextPart: Record<string, unknown> = part as Record<string, unknown>
    let partChanged = false

    for (const field of ['input', 'output'] as const) {
      if (!(field in nextPart)) {
        continue
      }
      const value = nextPart[field]
      const legacy = readLegacyTruncatedPayload(value)
      if (!legacy || legacy.preview.length <= previewChars) {
        continue
      }
      // Preserve the full marker object (including `type`); only slice preview.
      const record = value as Record<string, unknown>
      nextPart = {
        ...nextPart,
        [field]: {
          ...record,
          preview: legacy.preview.slice(0, previewChars),
        },
      }
      partChanged = true
    }

    if (!partChanged) {
      return part
    }
    changed = true
    return nextPart as UIMessage['parts'][number]
  })

  return changed ? { ...message, parts } : message
}

function selectBackfillBatch(input: {
  batchSize: number
  minRowChars: number
  cursorPayloadId: string
  maxPayloadIdAtStart: string
}): Array<{
  payloadId: string
  sessionId: string
  messageId: string
  messageJson: string
  errorText: string | null
}> {
  const messageJsonLength = sql`length(${chatMessagePayloads.messageJson})`
  const matchPredicate = and(
    or(
      like(chatMessagePayloads.messageJson, '%;base64,%'),
      like(chatMessagePayloads.messageJson, '%cradle.truncated-json-payload%'),
      // Large tool parts that were never truncated and hold no inline bytes —
      // the dominant unmatched category on a real ~868 MB database.
      like(chatMessagePayloads.messageJson, '%"type":"tool-%'),
    ),
    gt(messageJsonLength, input.minRowChars),
    gt(chatMessagePayloads.id, input.cursorPayloadId),
    lte(chatMessagePayloads.id, input.maxPayloadIdAtStart),
  )

  return db()
    .select({
      payloadId: chatMessagePayloads.id,
      sessionId: chatMessagePayloads.sessionId,
      messageId: messages.id,
      messageJson: chatMessagePayloads.messageJson,
      errorText: chatMessagePayloads.errorText,
    })
    .from(chatMessagePayloads)
    .innerJoin(messages, eq(messages.payloadId, chatMessagePayloads.id))
    .where(matchPredicate)
    .orderBy(asc(chatMessagePayloads.id))
    .limit(input.batchSize)
    .all()
}

function ensureBackfillTask(): typeof databaseMaintenanceTasks.$inferSelect {
  const existing = db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, CHAT_BLOB_BACKFILL_TASK_ID))
    .get()
  if (existing) {
    return existing
  }

  db()
    .insert(databaseMaintenanceTasks)
    .values({
      id: CHAT_BLOB_BACKFILL_TASK_ID,
      status: 'pending',
      requestedAt: currentUnixSeconds(),
      detailJson: JSON.stringify({
        cursorPayloadId: '',
        maxPayloadIdAtStart: null,
      } satisfies BackfillSweepDetail),
    })
    .onConflictDoNothing()
    .run()

  const created = db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, CHAT_BLOB_BACKFILL_TASK_ID))
    .get()
  if (!created) {
    throw new Error(`failed to create ${CHAT_BLOB_BACKFILL_TASK_ID} maintenance task`)
  }
  return created
}

function readSweepDetail(detailJson: string): BackfillSweepDetail {
  const parsed = JSON.parse(detailJson) as {
    cursorPayloadId?: string
    maxPayloadIdAtStart?: string | null
  }
  return {
    cursorPayloadId: parsed.cursorPayloadId ?? '',
    maxPayloadIdAtStart: parsed.maxPayloadIdAtStart ?? null,
  }
}

function persistSweepDetail(detail: BackfillSweepDetail): void {
  db()
    .update(databaseMaintenanceTasks)
    .set({
      detailJson: JSON.stringify(detail),
    })
    .where(eq(databaseMaintenanceTasks.id, CHAT_BLOB_BACKFILL_TASK_ID))
    .run()
}

function completeBackfillTask(detail: BackfillSweepDetail): void {
  db()
    .update(databaseMaintenanceTasks)
    .set({
      status: 'completed',
      completedAt: currentUnixSeconds(),
      detailJson: JSON.stringify(detail),
    })
    .where(eq(databaseMaintenanceTasks.id, CHAT_BLOB_BACKFILL_TASK_ID))
    .run()
}

function readMaxPayloadId(): string | null {
  const row = db()
    .select({ maxId: max(chatMessagePayloads.id) })
    .from(chatMessagePayloads)
    .get()
  return row?.maxId ?? null
}

function countBlobs(d: BlobStoreWriteHandle = db()): number {
  return d.select({ id: blobs.id }).from(blobs).all().length
}

function emptyResult(): MaintenanceResult {
  return {
    rowsScanned: 0,
    rowsRewritten: 0,
    blobsWritten: 0,
    bytesReclaimed: 0,
    rowsSkipped: 0,
  }
}
