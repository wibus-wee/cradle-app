import {
  backendRuns,
  backendRunSnapshotEvents,
  backendRunSnapshots,
  backendSessionBindings,
  chatMessageBlobRefs,
  chatMessagePayloads,
  chatSessionQueueItems,
  messages,
  runStreamCheckpoints,
  sessionEvents,
  stepUsage,
  usageLogs,
} from '@cradle/db'
import { eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { collectUnreferencedBlobIds } from '../blob-store/gc'
import * as Session from '../session/service'
import * as TurnCheckpoint from '../turn-checkpoint/service'
import { runRegistry } from './run-registry'
import type { RuntimeSessionStorageDeletionResult } from './runtime-provider-types'
import {
  buildRuntimeProviderInput,
  resolveRuntimeSessionContext,
} from './runtime-session-context'

export interface SessionTranscriptPurgeResult {
  sessionId: string
  nativeStorage: RuntimeSessionStorageDeletionResult | { status: 'failed', detail: string }
  attachmentBytesFreed: number
}

export async function purgeSessionTranscript(sessionId: string): Promise<SessionTranscriptPurgeResult> {
  const release = claimSessionStorageMaintenance([sessionId])
  try {
    return await purgeClaimedSessionTranscript(sessionId)
  }
  finally {
    release()
  }
}

export function claimSessionStorageMaintenance(sessionIds: string[]): () => void {
  const claimed: string[] = []
  for (const sessionId of sessionIds) {
    if (!runRegistry.claimSessionMaintenance(sessionId, 'storage-cleanup')) {
      for (const claimedSessionId of claimed) {
        runRegistry.releaseSessionMaintenance(claimedSessionId, 'storage-cleanup')
      }
      throw new AppError({
        code: 'storage_session_active',
        status: 409,
        message: 'Stop every active or pending run before managing storage.',
        details: { sessionId },
      })
    }
    claimed.push(sessionId)
  }
  return () => {
    for (const sessionId of claimed) {
      runRegistry.releaseSessionMaintenance(sessionId, 'storage-cleanup')
    }
  }
}

export async function purgeClaimedSessionTranscript(sessionId: string): Promise<SessionTranscriptPurgeResult> {
  const session = Session.get(sessionId)
  if (!session) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
  }
  if (runRegistry.getSessionMaintenance(sessionId) !== 'storage-cleanup') {
    throw new AppError({
      code: 'storage_maintenance_required',
      status: 500,
      message: 'Session storage cleanup requires an exclusive maintenance claim.',
      details: { sessionId },
    })
  }

  const nativeStorage = await deleteNativeSessionStorage(sessionId)
  await TurnCheckpoint.prepareSessionDeletion(sessionId)

  const blobIds = db()
    .select({ blobId: chatMessageBlobRefs.blobId })
    .from(chatMessageBlobRefs)
    .where(eq(chatMessageBlobRefs.sessionId, sessionId))
    .all()
    .map(row => row.blobId)

  db().transaction((tx) => {
    const snapshotIds = tx
      .select({ id: backendRunSnapshots.id })
      .from(backendRunSnapshots)
      .where(eq(backendRunSnapshots.chatSessionId, sessionId))
      .all()
      .map(row => row.id)
    if (snapshotIds.length > 0) {
      tx.delete(backendRunSnapshotEvents)
        .where(inArray(backendRunSnapshotEvents.snapshotId, snapshotIds))
        .run()
    }
    tx.delete(backendRunSnapshots).where(eq(backendRunSnapshots.chatSessionId, sessionId)).run()
    tx.delete(runStreamCheckpoints).where(eq(runStreamCheckpoints.sessionId, sessionId)).run()
    tx.delete(sessionEvents).where(eq(sessionEvents.aggregateId, sessionId)).run()
    tx.delete(usageLogs).where(eq(usageLogs.sessionId, sessionId)).run()
    tx.delete(stepUsage).where(eq(stepUsage.sessionId, sessionId)).run()
    tx.delete(chatSessionQueueItems).where(eq(chatSessionQueueItems.sessionId, sessionId)).run()
    tx.delete(backendRuns).where(eq(backendRuns.chatSessionId, sessionId)).run()
    tx.delete(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, sessionId)).run()
    tx.delete(chatMessageBlobRefs).where(eq(chatMessageBlobRefs.sessionId, sessionId)).run()
    tx.delete(messages).where(eq(messages.sessionId, sessionId)).run()
    tx.delete(chatMessagePayloads).where(eq(chatMessagePayloads.sessionId, sessionId)).run()
  })

  Session.cleanupSessionTranscriptResources(sessionId)
  const blobResult = await collectUnreferencedBlobIds(blobIds)
  return {
    sessionId,
    nativeStorage,
    attachmentBytesFreed: Number(blobResult.bytesFreed ?? 0),
  }
}

async function deleteNativeSessionStorage(
  sessionId: string,
): Promise<SessionTranscriptPurgeResult['nativeStorage']> {
  let resolved: Awaited<ReturnType<typeof resolveRuntimeSessionContext>> | null = null
  try {
    resolved = await resolveRuntimeSessionContext(sessionId)
    if (!resolved.runtime.deleteSessionStorage) {
      return {
        status: 'preserved',
        detail: `${resolved.runtimeKind} does not expose a safe native session delete operation.`,
      }
    }
    return await resolved.runtime.deleteSessionStorage(buildRuntimeProviderInput(resolved))
  }
  catch (error) {
    const appError = error instanceof AppError ? error : null
    if (appError?.code === 'chat_runtime_session_not_started') {
      return { status: 'not_applicable' }
    }
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  finally {
    resolved?.runtimeSession.providerRuntimeLease?.release()
  }
}
