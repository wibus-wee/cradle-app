import { randomUUID } from 'node:crypto'

import type { BackendSessionBinding } from '@cradle/db'
import { backendSessionBindings } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
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

export function readProviderRuntimeBinding(chatSessionId: string): BackendSessionBinding | undefined {
  return db()
    .select()
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, chatSessionId))
    .get()
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
  db()
    .delete(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, chatSessionId))
    .run()
}

export function writeProviderRuntimeBinding(input: ProviderRuntimeBindingWrite): BackendSessionBinding {
  const now = currentUnixSeconds()
  const existing = readProviderRuntimeBinding(input.chatSessionId)

  if (existing) {
    db()
      .update(backendSessionBindings)
      .set({
        providerTargetId: input.providerTargetId,
        runtimeKind: input.runtimeKind,
        backendSessionId: input.providerSessionId,
        backendStateSnapshot: input.providerStateSnapshot,
        requestedModelId: input.requestedModelId,
        updatedAt: now,
      })
      .where(eq(backendSessionBindings.id, existing.id))
      .run()
    return db()
      .select()
      .from(backendSessionBindings)
      .where(eq(backendSessionBindings.id, existing.id))
      .get()!
  }

  return db()
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
    .returning()
    .get()
}
