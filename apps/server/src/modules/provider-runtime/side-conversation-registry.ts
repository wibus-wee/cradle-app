import type { UIMessage } from 'ai'

import type { RuntimeSession } from '../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../provider-contracts/types'
import type { ProviderRuntimeLease } from './host-manager'
import { providerRuntimeHostManager } from './host-manager'

export interface SideConversationRecord {
  sideConversationId: string
  parentSessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
  history: UIMessage[]
  pinned: boolean
  lease: ProviderRuntimeLease<unknown>
}

export interface ReservedSideConversationHostLease {
  sideConversationId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  pinned: true
  lease: ProviderRuntimeLease<unknown>
}

const sideConversations = new Map<string, SideConversationRecord>()

function pruneExpiredSideConversations(): void {
  for (const [sideConversationId, record] of sideConversations) {
    if (!providerRuntimeHostManager.hasHost(record.lease.hostId)) {
      record.lease.release()
      sideConversations.delete(sideConversationId)
    }
  }
}

export function registerSideConversation(input: Omit<SideConversationRecord, 'lease' | 'pinned' | 'history'> & {
  history?: UIMessage[]
  hostLease: ReservedSideConversationHostLease
}): SideConversationRecord {
  pruneExpiredSideConversations()
  const hostLease = input.hostLease
  if (
    hostLease.sideConversationId !== input.sideConversationId
    || hostLease.providerTargetId !== input.providerTargetId
    || hostLease.runtimeKind !== input.runtimeKind
    || !hostLease.lease.pinned
  ) {
    hostLease.lease.release()
    throw new Error(`Reserved side conversation host lease does not match side conversation: ${input.sideConversationId}`)
  }
  const existing = sideConversations.get(input.sideConversationId)
  if (existing && existing.lease !== hostLease.lease) {
    existing.lease.release()
  }
  const record: SideConversationRecord = {
    sideConversationId: input.sideConversationId,
    parentSessionId: input.parentSessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId,
    history: input.history ? [...input.history] : [],
    pinned: true,
    lease: hostLease.lease,
  }
  sideConversations.set(input.sideConversationId, record)
  return record
}

export function reserveSideConversationHostLease(input: {
  sideConversationId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  ttlMs?: number
}): ReservedSideConversationHostLease {
  pruneExpiredSideConversations()
  const lease = providerRuntimeHostManager.acquireLease({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: input.sideConversationId,
    pinned: true,
    ttlMs: input.ttlMs,
  })
  return {
    sideConversationId: input.sideConversationId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    pinned: true,
    lease,
  }
}

export function readSideConversation(sideConversationId: string): SideConversationRecord | undefined {
  pruneExpiredSideConversations()
  return sideConversations.get(sideConversationId)
}

export function appendSideConversationHistory(sideConversationId: string, messages: UIMessage[]): SideConversationRecord | undefined {
  const record = readSideConversation(sideConversationId)
  if (!record) {
    return undefined
  }
  record.history.push(...messages)
  return record
}

export function refreshSideConversation(sideConversationId: string): SideConversationRecord | undefined {
  const record = readSideConversation(sideConversationId)
  if (!record) {
    return undefined
  }
  record.lease.refresh()
  return record
}

export function releaseSideConversation(sideConversationId: string): void {
  sideConversations.get(sideConversationId)?.lease.release()
  sideConversations.delete(sideConversationId)
}

export function releaseSideConversationsByParentSessionId(parentSessionId: string): void {
  for (const [sideConversationId, record] of sideConversations) {
    if (record.parentSessionId !== parentSessionId) {
      continue
    }
    record.lease.release()
    sideConversations.delete(sideConversationId)
  }
}

export function releaseSideConversationsByProviderTargetId(providerTargetId: string): void {
  for (const [sideConversationId, record] of sideConversations) {
    if (record.providerTargetId !== providerTargetId) {
      continue
    }
    record.lease.release()
    sideConversations.delete(sideConversationId)
  }
}

export function clearSideConversations(): void {
  for (const record of sideConversations.values()) {
    record.lease.release()
  }
  sideConversations.clear()
}
