import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  backendSessionBindings,
  blobs,
  chatMessageBlobRefs,
  chatMessagePayloads,
  messages,
  sessionEvents,
  sessions,
  workspaces,
} from '@cradle/db'
import { desc, eq, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { compactDatabase, db, getServerConfig } from '../../infra'
import { runRegistry } from '../chat-runtime/run-registry'
import {
  claimSessionStorageMaintenance,
  purgeClaimedSessionTranscript,
} from '../chat-runtime/session-storage'
import { measureKimiSessionStorage } from '../chat-runtime-providers/kimi/session-storage'
import * as Session from '../session/service'
import type {
  StorageCleanupResult,
  StorageCompaction,
  StorageOverview,
} from './model'

interface PathMeasurement {
  bytes: number
  fileCount: number
}

interface SessionAggregate {
  sessionId: string
  bytes: number
  count?: number
}

export function getStorageOverview(): StorageOverview {
  const config = getServerConfig()
  const dataDirectory = resolve(config.dataDir ?? dirname(config.dbPath))
  const total = measurePath(dataDirectory)
  const database = measureDatabase(config.dbPath)
  const runtime = measurePath(join(dataDirectory, 'runtimes'))
  const attachments = measurePath(join(dataDirectory, 'blobs'))
  const artifacts = measurePath(join(dataDirectory, 'chat-artifacts'))
  const terminal = measurePath(join(dataDirectory, 'terminal-history'))
  const diagnostics = addMeasurements(
    measurePath(join(dataDirectory, 'logs')),
    measurePath(join(dataDirectory, 'chat-runtime', 'traces')),
  )
  const knownBytes = database.bytes
    + runtime.bytes
    + attachments.bytes
    + artifacts.bytes
    + terminal.bytes
    + diagnostics.bytes
  const knownFiles = database.fileCount
    + runtime.fileCount
    + attachments.fileCount
    + artifacts.fileCount
    + terminal.fileCount
    + diagnostics.fileCount

  return {
    measuredAt: Math.floor(Date.now() / 1000),
    dataDirectory,
    totalBytes: total.bytes,
    categories: [
      { id: 'database', ...database },
      { id: 'runtime', ...runtime },
      { id: 'attachments', ...attachments },
      { id: 'artifacts', ...artifacts },
      { id: 'terminal', ...terminal },
      { id: 'diagnostics', ...diagnostics },
      {
        id: 'other',
        bytes: Math.max(0, total.bytes - knownBytes),
        fileCount: Math.max(0, total.fileCount - knownFiles),
      },
    ],
    sessions: listSessionStorage(dataDirectory),
  }
}

export async function purgeTranscripts(sessionIds: string[]) {
  const targets = prepareMutation(sessionIds)
  const release = claimSessionStorageMaintenance(targets)
  try {
    const cleanup: StorageCleanupResult[] = []
    for (const sessionId of targets) {
      cleanup.push(await purgeClaimedSessionTranscript(sessionId))
    }
    return finishMutation(cleanup)
  }
  finally {
    release()
  }
}

export async function deleteSessions(sessionIds: string[]) {
  const targets = prepareMutation(sessionIds)
  const release = claimSessionStorageMaintenance(targets)
  try {
    const cleanup: StorageCleanupResult[] = []
    for (const sessionId of targets) {
      const result = await purgeClaimedSessionTranscript(sessionId)
      await Session.remove(sessionId)
      cleanup.push(result)
    }
    return finishMutation(cleanup)
  }
  finally {
    release()
  }
}

function finishMutation(cleanup: StorageCleanupResult[]) {
  const compaction: StorageCompaction = runRegistry.hasActiveOrPendingRuns()
    ? { status: 'skipped_active_runs' }
    : compactDatabase()
  return { cleanup, compaction, overview: getStorageOverview() }
}

function prepareMutation(sessionIds: string[]): string[] {
  const targets = [...new Set(sessionIds)]
  for (const sessionId of targets) {
    if (!Session.get(sessionId)) {
      throw new AppError({
        code: 'session_not_found',
        status: 404,
        message: 'Session not found',
        details: { sessionId },
      })
    }
  }
  return targets
}

function listSessionStorage(dataDirectory: string): StorageOverview['sessions'] {
  const rows = db()
    .select({
      id: sessions.id,
      title: sessions.title,
      runtimeKind: sessions.runtimeKind,
      updatedAt: sessions.updatedAt,
      archivedAt: sessions.archivedAt,
      pinned: sessions.pinned,
      workspaceName: workspaces.name,
    })
    .from(sessions)
    .leftJoin(workspaces, eq(workspaces.id, sessions.workspaceId))
    .orderBy(desc(sessions.updatedAt))
    .all()

  const payloads = aggregatePayloadStorage()
  const events = aggregateEventStorage()
  const blobStorage = aggregateBlobStorage()
  const runtimeStorage = aggregateRuntimeStorage()
  return rows.map((row) => {
    const payload = payloads.get(row.id) ?? { bytes: 0, count: 0 }
    const eventBytes = events.get(row.id)?.bytes ?? 0
    const attachmentBytes = blobStorage.get(row.id)?.bytes ?? 0
    const artifactBytes = measurePath(join(dataDirectory, 'chat-artifacts', row.id)).bytes
    const terminalBytes = measurePath(join(dataDirectory, 'terminal-history', `${safeFileId(row.id)}.json`)).bytes
    const localBytes = payload.bytes + eventBytes
    const runtimeBytes = runtimeStorage.get(row.id)?.bytes ?? 0
    return {
      ...row,
      pinned: Boolean(row.pinned),
      active: runRegistry.hasActiveRunForSession(row.id) || runRegistry.hasPendingRun(row.id),
      messageCount: payload.count ?? 0,
      localBytes,
      runtimeBytes,
      attachmentBytes,
      artifactBytes,
      terminalBytes,
      reclaimableBytes: localBytes + runtimeBytes + attachmentBytes + artifactBytes + terminalBytes,
    }
  })
}

function aggregateRuntimeStorage(): Map<string, SessionAggregate> {
  const bindings = db()
    .select({
      sessionId: backendSessionBindings.chatSessionId,
      providerTargetId: backendSessionBindings.providerTargetId,
      providerSessionId: backendSessionBindings.backendSessionId,
    })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.runtimeKind, 'kimi'))
    .all()

  const storage = new Map<string, SessionAggregate>()
  for (const binding of bindings) {
    if (!binding.providerTargetId || !binding.providerSessionId) {
      continue
    }
    const measurement = measureKimiSessionStorage({
      providerTargetId: binding.providerTargetId,
      providerSessionId: binding.providerSessionId,
    })
    storage.set(binding.sessionId, { sessionId: binding.sessionId, bytes: measurement.bytes })
  }
  return storage
}

function aggregatePayloadStorage(): Map<string, SessionAggregate> {
  const rows = db()
    .select({
      sessionId: chatMessagePayloads.sessionId,
      bytes: sql<number>`coalesce(sum(length(${chatMessagePayloads.content}) + length(${chatMessagePayloads.messageJson}) + coalesce(length(${chatMessagePayloads.errorText}), 0)), 0)`,
      count: sql<number>`count(${messages.id})`,
    })
    .from(chatMessagePayloads)
    .leftJoin(messages, eq(messages.payloadId, chatMessagePayloads.id))
    .groupBy(chatMessagePayloads.sessionId)
    .all()
  return new Map(rows.map(row => [row.sessionId, { ...row, bytes: Number(row.bytes), count: Number(row.count) }]))
}

function aggregateEventStorage(): Map<string, SessionAggregate> {
  const rows = db()
    .select({
      sessionId: sessionEvents.aggregateId,
      bytes: sql<number>`coalesce(sum(length(${sessionEvents.payload})), 0)`,
    })
    .from(sessionEvents)
    .groupBy(sessionEvents.aggregateId)
    .all()
  return new Map(rows.map(row => [row.sessionId, { ...row, bytes: Number(row.bytes) }]))
}

function aggregateBlobStorage(): Map<string, SessionAggregate> {
  const rows = db()
    .select({
      sessionId: chatMessageBlobRefs.sessionId,
      blobId: chatMessageBlobRefs.blobId,
      bytes: blobs.byteSize,
    })
    .from(chatMessageBlobRefs)
    .innerJoin(blobs, eq(blobs.id, chatMessageBlobRefs.blobId))
    .all()

  const ownersByBlob = new Map<string, Set<string>>()
  const bytesByBlob = new Map<string, number>()
  for (const row of rows) {
    const owners = ownersByBlob.get(row.blobId) ?? new Set<string>()
    owners.add(row.sessionId)
    ownersByBlob.set(row.blobId, owners)
    bytesByBlob.set(row.blobId, row.bytes)
  }

  const storageBySession = new Map<string, SessionAggregate>()
  for (const [blobId, owners] of ownersByBlob) {
    if (owners.size !== 1) {
      continue
    }
    const sessionId = owners.values().next().value
    if (!sessionId) {
      continue
    }
    const aggregate = storageBySession.get(sessionId) ?? { sessionId, bytes: 0 }
    aggregate.bytes += bytesByBlob.get(blobId) ?? 0
    storageBySession.set(sessionId, aggregate)
  }
  return storageBySession
}

function measureDatabase(dbPath: string): PathMeasurement {
  if (dbPath === ':memory:') {
    return { bytes: 0, fileCount: 0 }
  }
  return addMeasurements(
    measurePath(dbPath),
    measurePath(`${dbPath}-wal`),
    measurePath(`${dbPath}-shm`),
  )
}

function measurePath(path: string): PathMeasurement {
  if (!existsSync(path)) {
    return { bytes: 0, fileCount: 0 }
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { bytes: stat.size, fileCount: 1 }
  }
  let measurement: PathMeasurement = { bytes: 0, fileCount: 0 }
  for (const entry of readdirSync(path)) {
    measurement = addMeasurements(measurement, measurePath(join(path, entry)))
  }
  return measurement
}

function addMeasurements(...measurements: PathMeasurement[]): PathMeasurement {
  return measurements.reduce<PathMeasurement>((total, item) => ({
    bytes: total.bytes + item.bytes,
    fileCount: total.fileCount + item.fileCount,
  }), { bytes: 0, fileCount: 0 })
}

function safeFileId(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_')
}
