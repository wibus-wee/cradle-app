import { chmodSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { Logger } from '../logging/logger'

/**
 * One-time cleanup for the pre-Fabric remote network model (plan 076,
 * Milestone 5). Runs before Drizzle migrations: when the legacy tables still
 * exist it first writes `legacy-remote-network-v1.json` next to the Cradle
 * data directory (atomic temp-file rename, mode 0600), then deletes local
 * remote projection sessions and remote-mounted workspace rows in one
 * transaction. The four legacy tables themselves are dropped by the Drizzle
 * migration that follows.
 *
 * The export contains display labels and old opaque ids/configurations only —
 * never key references, relay auth tokens, or pairing strings. Ordinary local
 * workspaces, sessions, messages, and Work rows stay untouched. Any failure
 * aborts server startup before schema migration; cleanup is never partial.
 */

export const LEGACY_REMOTE_NETWORK_EXPORT_FILE = 'legacy-remote-network-v1.json'

const LEGACY_TABLES = [
  'remote_hosts',
  'remote_session_links',
  'relay_host_enrollments',
  'relay_servers',
] as const

/** Config keys that may carry credentials or pairing material never belong in the export. */
const SENSITIVE_CONFIG_KEY = /secret|token|password|pairing|private|credential/i

interface LegacyTableRow {
  [column: string]: unknown
}

function tableExists(db: CleanupDb, table: string): boolean {
  const row = db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`)
    .at(0)
  return row !== undefined
}

function readRows(db: CleanupDb, table: string, columns: string[]): LegacyTableRow[] {
  return db.all<LegacyTableRow>(sql.raw(`SELECT ${columns.join(', ')} FROM ${table}`))
}

function scrubConfigJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) {
    return {}
  }
  try {
    return scrubValue(JSON.parse(raw))
  }
  catch {
    return {}
  }
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_CONFIG_KEY.test(key))
        .map(([key, entry]) => [key, scrubValue(entry)]),
    )
  }
  return value
}

function writeExportAtomic(exportPath: string, payload: unknown): void {
  const temporaryPath = `${exportPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, exportPath)
}

export interface LegacyRemoteNetworkCleanupResult {
  exportPath: string | null
  removedProjectionSessions: number
  removedRemoteWorkspaces: number
}

/** Minimal better-sqlite3 drizzle surface used by the cleanup; schema-agnostic. */
type CleanupDb = Pick<BetterSQLite3Database<any>, 'all' | 'get' | 'run' | 'transaction'>

export function runLegacyRemoteNetworkCleanup(
  db: CleanupDb,
  dataDir: string,
  logger: Logger,
): LegacyRemoteNetworkCleanupResult {
  const presentTables = LEGACY_TABLES.filter(table => tableExists(db, table))
  if (presentTables.length === 0) {
    return { exportPath: null, removedProjectionSessions: 0, removedRemoteWorkspaces: 0 }
  }

  const readOptional = (table: string, columns: string[]): LegacyTableRow[] =>
    presentTables.includes(table as typeof LEGACY_TABLES[number]) ? readRows(db, table, columns) : []

  const remoteHosts = readOptional('remote_hosts', ['id', 'display_name', 'enabled', 'connection_config_json', 'last_seen_at', 'created_at', 'updated_at'])
  const remoteSessionLinks = readOptional('remote_session_links', ['local_session_id', 'host_id', 'remote_session_id', 'remote_workspace_id', 'created_at', 'updated_at'])
  const relayHostEnrollments = readOptional('relay_host_enrollments', ['id', 'display_name', 'relay_url', 'room_id', 'status', 'created_at', 'updated_at'])
  const relayServers = readOptional('relay_servers', ['id', 'display_name', 'relay_url', 'enabled', 'is_default', 'created_at', 'updated_at'])

  const exportPath = join(dataDir, LEGACY_REMOTE_NETWORK_EXPORT_FILE)
  writeExportAtomic(exportPath, {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Legacy Remote Hosts / relay pairing metadata from before the Cradle Fabric migration. Secrets, key references, relay auth tokens, and pairing strings are intentionally excluded. Original sessions remain on their target machines; re-enroll nodes into a Fabric to regain access.',
    remoteHosts: remoteHosts.map(row => ({
      id: row.id,
      displayName: row.display_name,
      enabled: row.enabled,
      connectionConfig: scrubConfigJson(row.connection_config_json),
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    remoteSessionLinks: remoteSessionLinks.map(row => ({
      localSessionId: row.local_session_id,
      hostId: row.host_id,
      remoteSessionId: row.remote_session_id,
      remoteWorkspaceId: row.remote_workspace_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    relayHostEnrollments: relayHostEnrollments.map(row => ({
      id: row.id,
      displayName: row.display_name,
      relayUrl: row.relay_url,
      roomId: row.room_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    relayServers: relayServers.map(row => ({
      id: row.id,
      displayName: row.display_name,
      relayUrl: row.relay_url,
      enabled: row.enabled,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  })
  logger.info('Legacy remote network metadata exported', { exportPath })

  const removed = db.transaction((tx) => {
    let projectionSessions = 0
    if (presentTables.includes('remote_session_links')) {
      // Remote projection sessions are disposable local handles; the source
      // sessions stay on their target machines.
      tx.run(sql`DELETE FROM sessions WHERE id IN (SELECT local_session_id FROM remote_session_links)`)
      projectionSessions = tx.get<{ changes: number }>(sql`SELECT changes() AS changes`)?.changes ?? 0
    }
    // Remote-mounted workspaces carry a legacy `hostId` locator; local rows
    // used the same key with the value "local" and must survive.
    tx.run(sql`DELETE FROM workspaces WHERE locator_json LIKE '%"hostId"%' AND locator_json NOT LIKE '%"hostId":"local"%'`)
    const remoteWorkspaces = tx.get<{ changes: number }>(sql`SELECT changes() AS changes`)?.changes ?? 0
    return { projectionSessions, remoteWorkspaces }
  })

  logger.info('Legacy remote projections removed', {
    removedProjectionSessions: removed.projectionSessions,
    removedRemoteWorkspaces: removed.remoteWorkspaces,
  })
  return {
    exportPath,
    removedProjectionSessions: removed.projectionSessions,
    removedRemoteWorkspaces: removed.remoteWorkspaces,
  }
}
