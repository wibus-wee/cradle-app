import { backendSessionBindings } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'
import type { BackgroundActivityProgress } from '../background-activity/service'
import { getKimiServerResources } from '../chat-runtime-providers/kimi/resources'
import {
  deleteKimiSessionStorage,
  deleteKimiUnboundProviderSessionStorage,
  listKimiProviderStorageHomes,
  listKimiStoredSessionIds,
} from '../chat-runtime-providers/kimi/session-storage'
import * as Maintenance from '../maintenance/service'

const KIMI_ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export interface KimiOrphanStorageCleanupResult extends BackgroundActivityProgress {
  providerHomesScanned: number
  providerHomesSkipped: number
  sessionsDeleted: number
  bytesFreed: number
  indexEntriesRemoved: number
  cachesCleared: number
}

export function collectKimiOrphanSessionStorage(input: {
  deadline?: number
  runningProviderTargetIds?: ReadonlySet<string>
} = {}): KimiOrphanStorageCleanupResult {
  const bindings = db()
    .select({
      providerTargetId: backendSessionBindings.providerTargetId,
      providerSessionId: backendSessionBindings.backendSessionId,
    })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.runtimeKind, 'kimi'))
    .all()

  const boundSessions = new Map<string, Set<string>>()
  for (const binding of bindings) {
    if (!binding.providerTargetId || !binding.providerSessionId) {
      continue
    }
    const sessions = boundSessions.get(binding.providerTargetId) ?? new Set<string>()
    sessions.add(binding.providerSessionId)
    boundSessions.set(binding.providerTargetId, sessions)
  }

  const runningTargets = input.runningProviderTargetIds ?? new Set(getKimiServerResources()
    .filter(resource => resource.running)
    .map(resource => resource.providerTargetId))
  const result: KimiOrphanStorageCleanupResult = {
    providerHomesScanned: 0,
    providerHomesSkipped: 0,
    sessionsDeleted: 0,
    bytesFreed: 0,
    indexEntriesRemoved: 0,
    cachesCleared: 0,
  }

  for (const provider of listKimiProviderStorageHomes()) {
    if (Date.now() >= (input.deadline ?? Number.POSITIVE_INFINITY)) {
      break
    }
    if (runningTargets.has(provider.providerTargetId)) {
      result.providerHomesSkipped += 1
      continue
    }
    result.providerHomesScanned += 1
    const bound = boundSessions.get(provider.providerTargetId) ?? new Set<string>()
    if (bound.size === 0) {
      const cleanup = deleteKimiUnboundProviderSessionStorage(provider.providerTargetId)
      result.sessionsDeleted += cleanup.sessionCount
      result.bytesFreed += cleanup.bytes
      result.indexEntriesRemoved += cleanup.indexEntriesRemoved
      result.cachesCleared += Number(cleanup.cacheCleared)
      continue
    }
    const orphanIds = [...listKimiStoredSessionIds(provider.providerTargetId)]
      .filter(sessionId => !bound.has(sessionId))
    if (orphanIds.length === 0) {
      continue
    }
    const cleanup = deleteKimiSessionStorage({
      providerTargetId: provider.providerTargetId,
      providerSessionIds: orphanIds,
      clearDerivedCache: true,
    })
    result.sessionsDeleted += cleanup.sessionCount
    result.bytesFreed += cleanup.bytes
    result.indexEntriesRemoved += cleanup.indexEntriesRemoved
    result.cachesCleared += Number(cleanup.cacheCleared)
  }
  return result
}

export function registerStorageMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'storage',
    key: 'collect-kimi-orphan-sessions',
    title: 'Collect orphaned Kimi session data',
    intervalMs: KIMI_ORPHAN_CLEANUP_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    run: context => collectKimiOrphanSessionStorage({ deadline: context.deadline }),
  })
}
