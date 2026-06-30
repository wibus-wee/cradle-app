import { randomUUID } from 'node:crypto'

import type { RemoteHostAgentdSessionLink } from '@cradle/db'
import { remoteHostAgentdSessionLinks } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'

export interface UpsertRemoteHostAgentdSessionLinkInput {
  chatSessionId: string
  remoteHostId: string
  remoteAgentId: string
  remoteRuntimeKind: string
  daemonHostId?: string | null
  providerSessionId?: string | null
  stateSnapshotJson?: string
}

export function readRemoteHostAgentdSessionLink(chatSessionId: string): RemoteHostAgentdSessionLink | null {
  return db()
    .select()
    .from(remoteHostAgentdSessionLinks)
    .where(eq(remoteHostAgentdSessionLinks.chatSessionId, chatSessionId))
    .get() ?? null
}

export function upsertRemoteHostAgentdSessionLink(
  input: UpsertRemoteHostAgentdSessionLinkInput,
): RemoteHostAgentdSessionLink {
  const now = currentUnixSeconds()
  db()
    .insert(remoteHostAgentdSessionLinks)
    .values({
      id: randomUUID(),
      chatSessionId: input.chatSessionId,
      remoteHostId: input.remoteHostId,
      remoteAgentId: input.remoteAgentId,
      remoteRuntimeKind: input.remoteRuntimeKind,
      daemonHostId: input.daemonHostId ?? null,
      providerSessionId: input.providerSessionId ?? null,
      stateSnapshotJson: input.stateSnapshotJson ?? '{}',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: remoteHostAgentdSessionLinks.chatSessionId,
      set: {
        remoteHostId: input.remoteHostId,
        remoteAgentId: input.remoteAgentId,
        remoteRuntimeKind: input.remoteRuntimeKind,
        daemonHostId: input.daemonHostId ?? null,
        providerSessionId: input.providerSessionId ?? null,
        stateSnapshotJson: input.stateSnapshotJson ?? '{}',
        updatedAt: now,
      },
    })
    .run()

  return readRemoteHostAgentdSessionLink(input.chatSessionId) as RemoteHostAgentdSessionLink
}

export function deleteRemoteHostAgentdSessionLink(chatSessionId: string): void {
  db()
    .delete(remoteHostAgentdSessionLinks)
    .where(eq(remoteHostAgentdSessionLinks.chatSessionId, chatSessionId))
    .run()
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
