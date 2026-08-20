import { randomUUID } from 'node:crypto'

import { fabricMembership, trustGrants } from '@cradle/db'
import { and, eq, sql } from 'drizzle-orm'

import { db } from '../../infra'

const WORKTREE_SETUP_HOOK_CHECKSUM_SENTINEL = '*'

export interface WorktreeSetupHookTrustGrant {
  workspaceId: string
  reason: string | null
  updatedAt: number
}

function toGrant(row: typeof trustGrants.$inferSelect): WorktreeSetupHookTrustGrant {
  return {
    workspaceId: row.subjectKey,
    reason: row.reason,
    updatedAt: row.updatedAt,
  }
}

export function readWorktreeSetupHookTrustGrant(workspaceId: string): WorktreeSetupHookTrustGrant | null {
  const row = db()
    .select()
    .from(trustGrants)
    .where(and(
      eq(trustGrants.subjectType, 'worktree_setup_hook'),
      eq(trustGrants.subjectKey, workspaceId),
    ))
    .get()
  return row ? toGrant(row) : null
}

export function grantWorktreeSetupHookTrust(
  workspaceId: string,
  reason?: string | null,
): WorktreeSetupHookTrustGrant {
  db()
    .insert(trustGrants)
    .values({
      id: randomUUID(),
      subjectType: 'worktree_setup_hook',
      subjectKey: workspaceId,
      checksum: WORKTREE_SETUP_HOOK_CHECKSUM_SENTINEL,
      reason: reason ?? null,
    })
    .onConflictDoUpdate({
      target: [trustGrants.subjectType, trustGrants.subjectKey, trustGrants.checksum],
      set: {
        reason: reason ?? null,
        updatedAt: sql`(unixepoch())`,
      },
    })
    .run()

  return readWorktreeSetupHookTrustGrant(workspaceId)!
}

export function hasWorktreeSetupHookTrust(workspaceId: string): boolean {
  return readWorktreeSetupHookTrustGrant(workspaceId) !== null
}

export function isFabricNodeExposed(): boolean {
  return db()
    .select({ fabricId: fabricMembership.fabricId })
    .from(fabricMembership)
    .limit(1)
    .get() !== undefined
}
