import { randomUUID } from 'node:crypto'

import type { RelayServer } from '@cradle/db'
import { relayServers } from '@cradle/db'
import { and, asc, desc, eq, ne } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'

export interface RelayServerView extends RelayServer {}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function toRelayServerView(row: RelayServer): RelayServerView {
  return { ...row }
}

/**
 * Enforce the single-default invariant: at most one relay server may be the
 * default. Called after a create/update that sets isDefault=true — clears the
 * flag on every other server. If the resulting set has no default, leaves it
 * that way (default is optional).
 */
function enforceSingleDefault(exceptId: string): void {
  db()
    .update(relayServers)
    .set({ isDefault: false, updatedAt: currentUnixSeconds() })
    .where(and(eq(relayServers.isDefault, true), ne(relayServers.id, exceptId)))
    .run()
}

export function listRelayServers(): RelayServerView[] {
  return db()
    .select()
    .from(relayServers)
    .orderBy(desc(relayServers.isDefault), asc(relayServers.displayName), asc(relayServers.id))
    .all()
    .map(toRelayServerView)
}

export function readRelayServer(relayServerId: string): RelayServerView {
  const row = db()
    .select()
    .from(relayServers)
    .where(eq(relayServers.id, relayServerId))
    .get()
  if (!row) {
    throw new AppError({
      code: 'relay_server_not_found',
      status: 404,
      message: 'Relay server not found.',
      details: { relayServerId },
    })
  }
  return toRelayServerView(row)
}

export function createRelayServer(input: {
  id?: string
  displayName: string
  relayUrl: string
  enabled?: boolean
  isDefault?: boolean
}): RelayServerView {
  const now = currentUnixSeconds()
  const id = input.id ?? randomUUID()
  const isDefault = input.isDefault ?? false
  const row = db()
    .insert(relayServers)
    .values({
      id,
      displayName: input.displayName.trim(),
      relayUrl: input.relayUrl.trim(),
      enabled: input.enabled ?? true,
      isDefault,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  if (isDefault) {
    enforceSingleDefault(id)
  }
  return toRelayServerView(row)
}

export function updateRelayServer(
  relayServerId: string,
  patch: {
    displayName?: string
    relayUrl?: string
    enabled?: boolean
    isDefault?: boolean
  },
): RelayServerView {
  const current = readRelayServer(relayServerId)
  const update: Partial<typeof relayServers.$inferInsert> = {
    updatedAt: currentUnixSeconds(),
  }
  if (patch.displayName !== undefined) {
    update.displayName = patch.displayName.trim()
  }
  if (patch.relayUrl !== undefined) {
    update.relayUrl = patch.relayUrl.trim()
  }
  if (patch.enabled !== undefined) {
    update.enabled = patch.enabled
  }
  if (patch.isDefault !== undefined) {
    update.isDefault = patch.isDefault
  }

  const row = db()
    .update(relayServers)
    .set(update)
    .where(eq(relayServers.id, relayServerId))
    .returning()
    .get()

  if (patch.isDefault === true) {
    enforceSingleDefault(relayServerId)
  }
  return toRelayServerView(row ?? current)
}

export async function deleteRelayServer(relayServerId: string): Promise<void> {
  readRelayServer(relayServerId)
  db().delete(relayServers).where(eq(relayServers.id, relayServerId)).run()
}

/**
 * Resolve the default relay server (if any). Used by the pairing flow to offer
 * a sensible default when a host is paired without an explicit relay server.
 */
export function readDefaultRelayServer(): RelayServerView | null {
  const row = db()
    .select()
    .from(relayServers)
    .where(and(eq(relayServers.isDefault, true), eq(relayServers.enabled, true)))
    .get()
  return row ? toRelayServerView(row) : null
}

/**
 * Resolve the URL for a relay server by id. Throws a 404 AppError if it does
 * not exist or is disabled, so the pairing flow can surface a clean error.
 */
export function resolveRelayUrl(relayServerId: string): string {
  const server = readRelayServer(relayServerId)
  if (!server.enabled) {
    throw new AppError({
      code: 'relay_server_disabled',
      status: 400,
      message: 'Relay server is disabled.',
      details: { relayServerId },
    })
  }
  return server.relayUrl
}
