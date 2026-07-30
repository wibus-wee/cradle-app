/**
 * Dev-only: compact remaining steer splitParts rows and delete legacy truncated sessions.
 * Usage:
 *   CRADLE_DATA_DIR="~/Library/Application Support/@cradle/desktop/data" \
 *     node --import tsx scripts/run-local-payload-cleanup.ts
 */
import { chatMessagePayloads } from '@cradle/db'
import { like, sql } from 'drizzle-orm'

import { db, shutdownInfra } from '../src/infra'
import { backfillSteerSplitParts } from '../src/modules/chat-runtime/message-steer-split-backfill'
import * as Session from '../src/modules/session/service'
import * as TurnCheckpoint from '../src/modules/turn-checkpoint/service'

const LEGACY_MARKER = '%cradle.truncated-json-payload.v1%'

Session.registerSessionDeletingHandler(TurnCheckpoint.prepareSessionDeletion)

function legacySessionIds(): string[] {
  return db()
    .selectDistinct({ sessionId: chatMessagePayloads.sessionId })
    .from(chatMessagePayloads)
    .where(like(chatMessagePayloads.messageJson, LEGACY_MARKER))
    .all()
    .map(row => row.sessionId)
}

async function runSteerBackfill(): Promise<void> {
  for (let pass = 0; pass < 100; pass += 1) {
    const result = await backfillSteerSplitParts({
      deadline: Date.now() + 5 * 60 * 1000,
      report: (partial) => {
        process.stdout.write(
          `\rsteer pass ${pass + 1}: scanned=${partial.rowsScanned} rewritten=${partial.rowsRewritten} reclaimed=${partial.bytesReclaimed}`,
        )
      },
    })
    console.log(`\nsteer pass ${pass + 1} done:`, result)
    if (result.rowsRewritten === 0 && result.rowsScanned === 0) {
      break
    }
  }
}

async function deleteLegacySessions(): Promise<string[]> {
  const ids = legacySessionIds()
  console.log(`deleting ${ids.length} legacy truncated sessions...`)
  const failed: string[] = []
  let deleted = 0
  for (const id of ids) {
    try {
      await Session.remove(id)
      deleted += 1
      if (deleted % 10 === 0 || deleted === ids.length) {
        console.log(`deleted ${deleted}/${ids.length}`)
      }
    }
    catch (error) {
      failed.push(id)
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`skip ${id}: ${message}`)
    }
  }
  return failed
}

try {
  await runSteerBackfill()
  let failed = await deleteLegacySessions()
  if (failed.length > 0) {
    console.log(`retrying ${failed.length} sessions after checkpoint cleanup pass...`)
    for (let pass = 0; pass < 3 && failed.length > 0; pass += 1) {
      await TurnCheckpoint.maintainTurnCheckpointCleanup(200)
      const retryFailed: string[] = []
      for (const id of failed) {
        try {
          await Session.remove(id)
          console.log(`deleted on retry: ${id}`)
        }
        catch (error) {
          retryFailed.push(id)
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`still blocked ${id}: ${message}`)
        }
      }
      failed = retryFailed
    }
    if (failed.length > 0) {
      console.log('checkpoint-blocked session ids:', failed.join(', '))
    }
  }

  const remainingLegacy = legacySessionIds().length
  const steerRows = db()
    .select({ count: sql<number>`count(*)` })
    .from(chatMessagePayloads)
    .where(sql`${chatMessagePayloads.messageJson} LIKE '%"splitParts"%' AND ${chatMessagePayloads.messageJson} LIKE '%"mode":"steer"%'`)
    .get()
?.count ?? 0

  console.log('remaining legacy sessions:', remainingLegacy)
  console.log('remaining steer split rows:', steerRows)
}
finally {
  shutdownInfra()
}
