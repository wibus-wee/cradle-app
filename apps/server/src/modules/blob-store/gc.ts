import { rm } from 'node:fs/promises'

import { blobs, chatMessageBlobRefs, messages } from '@cradle/db'
import { and, eq, inArray, isNull, lt } from 'drizzle-orm'

import { readPositiveIntegerEnv } from '../../helpers/env'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { MaintenanceResult } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'
import { resolveBlobStorePath } from './service'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_GRACE_SECONDS = 3600
const MAX_BLOBS_PER_PASS = 500

function readGraceSeconds(): number {
  return Math.max(
    DEFAULT_GRACE_SECONDS,
    readPositiveIntegerEnv('CRADLE_BLOB_GC_GRACE_SECONDS', DEFAULT_GRACE_SECONDS),
  )
}

/**
 * Drop orphan refs, then collect unreferenced blobs past the grace period.
 * Grace covers the ref → message write window on both phases. Configuration may
 * extend the one-hour safety window, but cannot shorten it.
 */
export async function collectUnreferencedBlobs(): Promise<MaintenanceResult> {
  const cutoff = currentUnixSeconds() - readGraceSeconds()
  let refsDropped = 0
  let blobsCollected = 0
  let blobsSkipped = 0
  let bytesFreed = 0

  // Phase A — orphan refs. messageId has no FK, so a crash between ref insert and
  // message commit (or a rollback that removes the message) leaves refs behind.
  // Without this phase those refs would pin their blobs forever. The grace period
  // keeps a mid-write ref alive until its message can commit.
  const orphanRefs = db()
    .select({ id: chatMessageBlobRefs.id })
    .from(chatMessageBlobRefs)
    .leftJoin(messages, eq(messages.id, chatMessageBlobRefs.messageId))
    .where(and(
      isNull(messages.id),
      lt(chatMessageBlobRefs.createdAt, cutoff),
    ))
    .all()

  for (const orphan of orphanRefs) {
    db().delete(chatMessageBlobRefs).where(eq(chatMessageBlobRefs.id, orphan.id)).run()
    refsDropped += 1
  }

  // Phase B — unreferenced blobs. Chat writers claim blob + ref atomically, but
  // keep the same safety window for aborted writes and future blob-store owners.
  // Bound each pass so Background Activity stays interruptible.
  const collectable = db()
    .select({
      id: blobs.id,
      storagePath: blobs.storagePath,
      byteSize: blobs.byteSize,
    })
    .from(blobs)
    .leftJoin(chatMessageBlobRefs, eq(chatMessageBlobRefs.blobId, blobs.id))
    .where(and(
      isNull(chatMessageBlobRefs.id),
      lt(blobs.createdAt, cutoff),
    ))
    .limit(MAX_BLOBS_PER_PASS)
    .all()

  for (const blob of collectable) {
    // Delete the row before unlinking the file, never the reverse. `putBlob`
    // deduplicates by content hash and media type, so it can hand this very row
    // to a writer whose ref insert then makes this delete fail under
    // `onDelete: 'restrict'`. Row-first
    // turns that interleaving into a no-op with the bytes intact; file-first would
    // unlink bytes that a live ref and a stored message still point at, which is
    // exactly the silent loss this store exists to remove.
    try {
      db().delete(blobs).where(eq(blobs.id, blob.id)).run()
    }
    catch {
      // Lost the race: a ref now pins this blob. Leave it for a later pass.
      blobsSkipped += 1
      continue
    }
    // A crash here leaks the file with no row. That is harmless garbage: the path
    // is content-addressed and `putBlob` rewrites it without an exclusive flag.
    await rm(resolveBlobStorePath(blob.storagePath), { force: true })
    blobsCollected += 1
    bytesFreed += blob.byteSize
  }

  return { refsDropped, blobsCollected, blobsSkipped, bytesFreed }
}

export async function collectUnreferencedBlobIds(blobIds: string[]): Promise<MaintenanceResult> {
  if (blobIds.length === 0) {
    return { refsDropped: 0, blobsCollected: 0, blobsSkipped: 0, bytesFreed: 0 }
  }
  let blobsCollected = 0
  let blobsSkipped = 0
  let bytesFreed = 0
  const candidates = db()
    .select({ id: blobs.id, storagePath: blobs.storagePath, byteSize: blobs.byteSize })
    .from(blobs)
    .leftJoin(chatMessageBlobRefs, eq(chatMessageBlobRefs.blobId, blobs.id))
    .where(and(inArray(blobs.id, blobIds), isNull(chatMessageBlobRefs.id)))
    .all()

  for (const blob of candidates) {
    try {
      db().delete(blobs).where(eq(blobs.id, blob.id)).run()
    }
    catch {
      blobsSkipped += 1
      continue
    }
    await rm(resolveBlobStorePath(blob.storagePath), { force: true })
    blobsCollected += 1
    bytesFreed += blob.byteSize
  }
  return { refsDropped: 0, blobsCollected, blobsSkipped, bytesFreed }
}

export function registerBlobStoreMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'blob-store',
    key: 'collect-unreferenced-blobs',
    title: 'Collect unreferenced blobs',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    run: () => collectUnreferencedBlobs(),
  })
}
