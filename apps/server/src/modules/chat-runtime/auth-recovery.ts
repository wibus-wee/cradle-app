import type { ProviderAuthMethod } from '@cradle/chat-runtime-contracts'
import { chatRuntimeAuthRecoveries, chatSessionQueueItems } from '@cradle/db'
import { and, desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { RuntimeKind } from '../provider-contracts/types'
import { enqueueSessionQueueItem } from './queue/api'
import {
  parseQueueContextParts,
  parseQueueFiles,
  readPersistedThinkingEffort,
  readQueueItemRuntimeSettings,
} from './queue/session-queue'
import { ProviderRuntimeError } from './runtime-provider-types'

export interface RuntimeAuthRecoveryView {
  sessionId: string
  queueItemId: string
  runId: string | null
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  provider: string
  methods: ProviderAuthMethod[]
  configurationTarget: { namespace: string, resourceId: string }
  createdAt: number
  updatedAt: number
}

export function recordRuntimeAuthRecovery(input: {
  error: unknown
  sessionId: string
  queueItemId?: string | null
  runId?: string | null
  providerTargetId?: string | null
  runtimeKind: RuntimeKind
}): boolean {
  if (!(input.error instanceof ProviderRuntimeError) || input.error.providerError._tag !== 'auth_required') {
    return false
  }
  const queueItemId = input.queueItemId ?? null
  const target = input.error.providerError.configurationTarget
  if (!queueItemId || !target) {
    return false
  }
  const now = currentUnixSeconds()
  db().insert(chatRuntimeAuthRecoveries).values({
    queueItemId,
    sessionId: input.sessionId,
    runId: input.runId ?? null,
    providerTargetId: input.providerTargetId ?? null,
    runtimeKind: input.runtimeKind,
    provider: input.error.providerError.provider,
    methodsJson: JSON.stringify(input.error.providerError.methods),
    configurationNamespace: target.namespace,
    configurationResourceId: target.resourceId,
    status: 'pending',
    retryQueueItemId: null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: chatRuntimeAuthRecoveries.queueItemId,
    set: {
      runId: input.runId ?? null,
      providerTargetId: input.providerTargetId ?? null,
      methodsJson: JSON.stringify(input.error.providerError.methods),
      configurationNamespace: target.namespace,
      configurationResourceId: target.resourceId,
      status: 'pending',
      retryQueueItemId: null,
      updatedAt: now,
    },
  }).run()
  return true
}

export function readPendingRuntimeAuthRecovery(sessionId: string): RuntimeAuthRecoveryView | null {
  const row = db().select().from(chatRuntimeAuthRecoveries).where(and(
    eq(chatRuntimeAuthRecoveries.sessionId, sessionId),
    eq(chatRuntimeAuthRecoveries.status, 'pending'),
  )).orderBy(desc(chatRuntimeAuthRecoveries.updatedAt)).get()
  if (!row) { return null }
  return {
    sessionId: row.sessionId,
    queueItemId: row.queueItemId,
    runId: row.runId,
    providerTargetId: row.providerTargetId,
    runtimeKind: row.runtimeKind as RuntimeKind,
    provider: row.provider,
    methods: JSON.parse(row.methodsJson) as RuntimeAuthRecoveryView['methods'],
    configurationTarget: {
      namespace: row.configurationNamespace,
      resourceId: row.configurationResourceId,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function retryRuntimeAuthRecovery(
  sessionId: string,
  scheduleSessionQueueDrain: (sessionId: string) => void,
): Promise<{ ok: true, queueItemId: string }> {
  const recovery = readPendingRuntimeAuthRecovery(sessionId)
  if (!recovery) {
    throw new AppError({
      code: 'chat_runtime_auth_recovery_not_found',
      status: 404,
      message: 'Pending runtime authentication recovery was not found',
      details: { sessionId },
    })
  }
  const original = db().select().from(chatSessionQueueItems).where(and(
    eq(chatSessionQueueItems.id, recovery.queueItemId),
    eq(chatSessionQueueItems.sessionId, sessionId),
  )).get()
  if (!original || original.status !== 'failed') {
    throw new AppError({
      code: 'chat_runtime_auth_recovery_invalid',
      status: 409,
      message: 'The original failed input is no longer available for retry',
      details: { sessionId, queueItemId: recovery.queueItemId, status: original?.status ?? 'missing' },
    })
  }
  const claim = db().update(chatRuntimeAuthRecoveries).set({
    status: 'retrying',
    updatedAt: currentUnixSeconds(),
  }).where(and(
    eq(chatRuntimeAuthRecoveries.queueItemId, recovery.queueItemId),
    eq(chatRuntimeAuthRecoveries.status, 'pending'),
  )).run()
  if (claim.changes !== 1) {
    throw new AppError({
      code: 'chat_runtime_auth_recovery_in_progress',
      status: 409,
      message: 'Runtime authentication recovery is already being retried',
      details: { sessionId, queueItemId: recovery.queueItemId },
    })
  }

  try {
    const retry = await enqueueSessionQueueItem({
      sessionId,
      text: original.text,
      files: parseQueueFiles(original.filesJson),
      contextParts: parseQueueContextParts(original.contextPartsJson),
      providerTargetId: original.providerTargetId ?? undefined,
      modelId: original.modelId,
      thinkingEffort: readPersistedThinkingEffort(original.thinkingEffort) ?? undefined,
      runtimeSettings: readQueueItemRuntimeSettings(recovery.runtimeKind, original),
      mode: original.mode === 'steer' ? 'steer' : 'queue',
      placement: 'front',
    }, { scheduleSessionQueueDrain })
    db().update(chatRuntimeAuthRecoveries).set({
      status: 'resolved',
      retryQueueItemId: retry.id,
      updatedAt: currentUnixSeconds(),
    }).where(and(
      eq(chatRuntimeAuthRecoveries.queueItemId, recovery.queueItemId),
      eq(chatRuntimeAuthRecoveries.status, 'retrying'),
    )).run()
    return { ok: true, queueItemId: retry.id }
  }
  catch (error) {
    db().update(chatRuntimeAuthRecoveries).set({
      status: 'pending',
      updatedAt: currentUnixSeconds(),
    }).where(and(
      eq(chatRuntimeAuthRecoveries.queueItemId, recovery.queueItemId),
      eq(chatRuntimeAuthRecoveries.status, 'retrying'),
    )).run()
    throw error
  }
}

export function cancelRuntimeAuthRecovery(sessionId: string): { ok: true } {
  const recovery = readPendingRuntimeAuthRecovery(sessionId)
  if (!recovery) {
    return { ok: true }
  }
  db().update(chatRuntimeAuthRecoveries).set({
    status: 'cancelled',
    updatedAt: currentUnixSeconds(),
  }).where(eq(chatRuntimeAuthRecoveries.queueItemId, recovery.queueItemId)).run()
  return { ok: true }
}
