import { compactChatMessageSplitMetadata } from '@cradle/chat-runtime-contracts'
import { chatMessagePayloads, databaseMaintenanceTasks, messages } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, asc, eq, gt, like, sql } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { MaintenanceResult, MaintenanceRunContext } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'
import { updateMessagePayload } from './message-payload-store'
import { extractMessageText } from './ui-message'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
/** Well above Maintenance's 30s default so a large batch is not aborted mid-pass. */
const DEFAULT_MAX_RUN_MS = 5 * 60 * 1000
const DEFAULT_BATCH_SIZE = 100

export const CHAT_STEER_SPLIT_BACKFILL_TASK_ID = 'chat-steer-split-backfill-v1'

interface SteerSplitSweepDetail {
  cursorPayloadId: string
}

/**
 * Rewrite legacy steer rows that still embed full tool/file payloads inside
 * `metadata.cradle.continuation.splitParts`. Live steer turns already persist
 * compact boundaries; this terminating sweep repairs historical rows only.
 */
export async function backfillSteerSplitParts(
  context: Pick<MaintenanceRunContext, 'deadline' | 'report'>,
): Promise<MaintenanceResult> {
  const task = ensureSteerSplitBackfillTask()
  if (task.status === 'completed') {
    return emptyResult()
  }

  let detail = readSweepDetail(task.detailJson)
  let rowsScanned = 0
  let rowsRewritten = 0
  let bytesReclaimed = 0
  let rowsSkipped = 0
  let cursorPayloadId = detail.cursorPayloadId

  while (Date.now() < context.deadline) {
    const batch = selectSteerSplitBatch({
      batchSize: DEFAULT_BATCH_SIZE,
      cursorPayloadId,
    })
    if (batch.length === 0) {
      completeSteerSplitBackfillTask({ cursorPayloadId })
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

      const compacted = compactChatMessageSplitMetadata(parsed)
      const nextJson = JSON.stringify(compacted)
      if (nextJson === row.messageJson) {
        continue
      }

      db().transaction((tx) => {
        updateMessagePayload(tx, {
          id: row.payloadId,
          sessionId: row.sessionId,
          content: extractMessageText(compacted),
          messageJson: nextJson,
          errorText: row.errorText,
          updatedAt: currentUnixSeconds(),
        })
      })

      rowsRewritten += 1
      bytesReclaimed += Math.max(0, row.messageJson.length - nextJson.length)
    }

    detail = { cursorPayloadId }
    persistSweepDetail(detail)

    context.report({
      rowsScanned,
      rowsRewritten,
      bytesReclaimed,
      rowsSkipped,
    })
  }

  return {
    rowsScanned,
    rowsRewritten,
    bytesReclaimed,
    rowsSkipped,
  }
}

export function registerMessageSteerSplitBackfillMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'chat-runtime',
    key: 'backfill-steer-split-parts',
    title: 'Backfill steer splitParts metadata',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    maxRunMs: DEFAULT_MAX_RUN_MS,
    run: context => backfillSteerSplitParts(context),
  })
}

function selectSteerSplitBatch(input: {
  batchSize: number
  cursorPayloadId: string
}): Array<{
  payloadId: string
  sessionId: string
  messageJson: string
  errorText: string | null
}> {
  return db()
    .select({
      payloadId: chatMessagePayloads.id,
      sessionId: chatMessagePayloads.sessionId,
      messageJson: chatMessagePayloads.messageJson,
      errorText: chatMessagePayloads.errorText,
    })
    .from(chatMessagePayloads)
    .innerJoin(messages, sql`${messages.payloadId} = ${chatMessagePayloads.id}`)
    .where(and(
      like(chatMessagePayloads.messageJson, '%"splitParts"%'),
      like(chatMessagePayloads.messageJson, '%"mode":"steer"%'),
      gt(chatMessagePayloads.id, input.cursorPayloadId),
    ))
    .orderBy(asc(chatMessagePayloads.id))
    .limit(input.batchSize)
    .all()
}

function ensureSteerSplitBackfillTask(): typeof databaseMaintenanceTasks.$inferSelect {
  const existing = db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, CHAT_STEER_SPLIT_BACKFILL_TASK_ID))
    .get()
  if (existing) {
    return existing
  }

  db()
    .insert(databaseMaintenanceTasks)
    .values({
      id: CHAT_STEER_SPLIT_BACKFILL_TASK_ID,
      status: 'pending',
      requestedAt: currentUnixSeconds(),
      detailJson: JSON.stringify({
        cursorPayloadId: '',
      } satisfies SteerSplitSweepDetail),
    })
    .onConflictDoNothing()
    .run()

  const created = db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, CHAT_STEER_SPLIT_BACKFILL_TASK_ID))
    .get()
  if (!created) {
    throw new Error(`failed to create ${CHAT_STEER_SPLIT_BACKFILL_TASK_ID} maintenance task`)
  }
  return created
}

function readSweepDetail(detailJson: string): SteerSplitSweepDetail {
  const parsed = JSON.parse(detailJson) as { cursorPayloadId?: string }
  return {
    cursorPayloadId: parsed.cursorPayloadId ?? '',
  }
}

function persistSweepDetail(detail: SteerSplitSweepDetail): void {
  db()
    .update(databaseMaintenanceTasks)
    .set({
      detailJson: JSON.stringify(detail),
    })
    .where(eq(databaseMaintenanceTasks.id, CHAT_STEER_SPLIT_BACKFILL_TASK_ID))
    .run()
}

function completeSteerSplitBackfillTask(detail: SteerSplitSweepDetail): void {
  db()
    .update(databaseMaintenanceTasks)
    .set({
      status: 'completed',
      completedAt: currentUnixSeconds(),
      detailJson: JSON.stringify(detail),
    })
    .where(eq(databaseMaintenanceTasks.id, CHAT_STEER_SPLIT_BACKFILL_TASK_ID))
    .run()
}

function emptyResult(): MaintenanceResult {
  return {
    rowsScanned: 0,
    rowsRewritten: 0,
    bytesReclaimed: 0,
    rowsSkipped: 0,
  }
}
