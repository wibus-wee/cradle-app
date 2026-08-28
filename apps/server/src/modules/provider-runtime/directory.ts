import { randomUUID } from 'node:crypto'

import type { BackendSessionBinding } from '@cradle/db'
import { backendSessionBindings } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db, registerBeforeDatabaseShutdown } from '../../infra'
import type { RuntimeKind } from '../provider-contracts/types'

export interface ProviderRuntimeBindingWrite {
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  providerSessionId: string
  providerStateSnapshot: string | null
  requestedModelId: string | null
}

export type ProviderRuntimeBindingDirectoryWriter = Pick<ReturnType<typeof db>, 'update'>

type ProviderRuntimeDatabase = ReturnType<typeof db>
const absentBindings = new Map<ProviderRuntimeDatabase, Set<string>>()
const MAX_ABSENT_BINDINGS = 4_096

registerBeforeDatabaseShutdown(() => absentBindings.clear())

function absentBindingIdsFor(database: ProviderRuntimeDatabase): Set<string> {
  let sessionIds = absentBindings.get(database)
  if (!sessionIds) {
    sessionIds = new Set()
    absentBindings.set(database, sessionIds)
  }
  return sessionIds
}

function rememberAbsentBinding(database: ProviderRuntimeDatabase, chatSessionId: string): void {
  const sessionIds = absentBindingIdsFor(database)
  if (sessionIds.size >= MAX_ABSENT_BINDINGS) {
    const oldestSessionId = sessionIds.values().next().value
    if (oldestSessionId) {
      sessionIds.delete(oldestSessionId)
    }
  }
  sessionIds.add(chatSessionId)
}

export function readProviderRuntimeBinding(chatSessionId: string): BackendSessionBinding | undefined {
  const database = db()
  const absentSessionIds = absentBindingIdsFor(database)
  if (absentSessionIds.has(chatSessionId)) {
    return undefined
  }
  const binding = database
    .select()
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, chatSessionId))
    .get()
  if (!binding) {
    rememberAbsentBinding(database, chatSessionId)
  }
  return binding
}

export function listProviderRuntimeBindingsByProviderSession(input: {
  providerSessionId: string
  runtimeKind?: RuntimeKind
}): BackendSessionBinding[] {
  return db()
    .select()
    .from(backendSessionBindings)
    .where(
      input.runtimeKind
        ? and(
            eq(backendSessionBindings.backendSessionId, input.providerSessionId),
            eq(backendSessionBindings.runtimeKind, input.runtimeKind),
          )
        : eq(backendSessionBindings.backendSessionId, input.providerSessionId),
    )
    .all()
    .filter(isResumableProviderRuntimeBinding)
}

export function clearProviderTargetFromProviderRuntimeBindings(
  providerTargetId: string,
  writer: ProviderRuntimeBindingDirectoryWriter = db(),
): void {
  writer.update(backendSessionBindings)
    .set({ providerTargetId: null, updatedAt: currentUnixSeconds() })
    .where(eq(backendSessionBindings.providerTargetId, providerTargetId))
    .run()
}

export function readReusableProviderRuntimeBinding(input: {
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
}): BackendSessionBinding | undefined {
  const binding = readProviderRuntimeBinding(input.chatSessionId)
  return binding?.providerTargetId === input.providerTargetId
    && binding.runtimeKind === input.runtimeKind
    && isResumableProviderRuntimeBinding(binding)
    ? binding
    : undefined
}

export function isResumableProviderRuntimeBinding(binding: BackendSessionBinding | undefined): binding is BackendSessionBinding {
  return typeof binding?.backendSessionId === 'string' && binding.backendSessionId.length > 0
}

export function deleteProviderRuntimeBinding(chatSessionId: string): void {
  const database = db()
  database
    .delete(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, chatSessionId))
    .run()
  rememberAbsentBinding(database, chatSessionId)
}

export function writeProviderRuntimeBinding(input: ProviderRuntimeBindingWrite): BackendSessionBinding {
  const now = currentUnixSeconds()
  const database = db()
  const binding = database
    .insert(backendSessionBindings)
    .values({
      id: randomUUID(),
      chatSessionId: input.chatSessionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      backendSessionId: input.providerSessionId,
      backendStateSnapshot: input.providerStateSnapshot,
      requestedModelId: input.requestedModelId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: backendSessionBindings.chatSessionId,
      set: {
        providerTargetId: input.providerTargetId,
        runtimeKind: input.runtimeKind,
        backendSessionId: input.providerSessionId,
        backendStateSnapshot: input.providerStateSnapshot,
        requestedModelId: input.requestedModelId,
        updatedAt: now,
      },
    })
    .returning()
    .get()
  absentBindingIdsFor(database).delete(input.chatSessionId)
  return binding
}
