import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  LEGACY_REMOTE_NETWORK_EXPORT_FILE,
  runLegacyRemoteNetworkCleanup,
} from '../src/database/legacy-remote-network-cleanup'
import type { Logger } from '../src/logging/logger'

/**
 * Plan 076 Milestone 5 upgrade fixture: a database that still carries the
 * legacy Remote Hosts / relay pairing tables must produce a sanitized JSON
 * export, keep local entities, and remove remote projection rows before the
 * Drizzle migration drops the legacy tables.
 */

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger

function createLegacyFixture(dataDir: string) {
  const sqlite = new Database(join(dataDir, 'cradle.db'))
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    CREATE TABLE workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      locator_json text NOT NULL,
      git_identity_json text NOT NULL DEFAULT '{}',
      identifier text NOT NULL DEFAULT '',
      pinned integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE sessions (
      id text PRIMARY KEY,
      workspace_id text REFERENCES workspaces(id) ON DELETE cascade,
      title text NOT NULL,
      title_source text NOT NULL DEFAULT 'initial',
      origin text NOT NULL DEFAULT 'manual',
      runtime_kind text NOT NULL DEFAULT 'standard',
      config_json text NOT NULL DEFAULT '{}',
      pinned integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE remote_hosts (
      id text PRIMARY KEY,
      display_name text NOT NULL,
      enabled integer NOT NULL DEFAULT 1,
      connection_config_json text NOT NULL DEFAULT '{}',
      capabilities_json text NOT NULL DEFAULT '{}',
      last_seen_at integer,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE remote_session_links (
      local_session_id text PRIMARY KEY REFERENCES sessions(id) ON DELETE cascade,
      host_id text NOT NULL,
      remote_session_id text NOT NULL,
      remote_workspace_id text NOT NULL,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE relay_host_enrollments (
      id text PRIMARY KEY,
      display_name text NOT NULL,
      relay_url text NOT NULL,
      room_id text NOT NULL,
      host_pubkey text NOT NULL,
      host_private_key_secret_id text NOT NULL,
      pinned_controller_pubkey text,
      status text NOT NULL DEFAULT 'pending',
      pairing_code text,
      last_error text,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE relay_servers (
      id text PRIMARY KEY,
      display_name text NOT NULL,
      relay_url text NOT NULL,
      enabled integer NOT NULL DEFAULT 1,
      is_default integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );

    INSERT INTO workspaces (id, name, locator_json) VALUES
      ('ws-local', 'local project', '{"hostId":"local","path":"/tmp/local-project"}'),
      ('ws-remote', 'remote project', '{"hostId":"host-1","path":"/srv/remote-project"}');
    INSERT INTO sessions (id, workspace_id, title) VALUES
      ('session-local', 'ws-local', 'Local session'),
      ('session-projection', 'ws-remote', 'Remote projection');
    INSERT INTO remote_hosts (id, display_name, connection_config_json) VALUES
      ('host-1', 'Office box', '{"transport":"relay","relayUrl":"https://relay.example.com","authToken":"shh","keySecretId":"sec-1","nested":{"password":"hunter2"}}');
    INSERT INTO remote_session_links (local_session_id, host_id, remote_session_id, remote_workspace_id) VALUES
      ('session-projection', 'host-1', 'remote-session-9', 'remote-ws-9');
    INSERT INTO relay_host_enrollments (id, display_name, relay_url, room_id, host_pubkey, host_private_key_secret_id, pairing_code) VALUES
      ('enroll-1', 'Headless box', 'https://relay.example.com', 'room-1', 'pubkey', 'sec-2', 'PAIR-1234');
    INSERT INTO relay_servers (id, display_name, relay_url, is_default) VALUES
      ('relay-1', 'Default relay', 'https://relay.example.com', 1);
  `)
  return drizzle(sqlite)
}

describe('legacy remote network cleanup', () => {
  const dataDirs: string[] = []
  const makeDataDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-legacy-cleanup-'))
    dataDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dataDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exports sanitized metadata, keeps local data, and removes remote projections', () => {
    const dataDir = makeDataDir()
    const db = createLegacyFixture(dataDir)

    const result = runLegacyRemoteNetworkCleanup(db, dataDir, silentLogger)

    expect(result.exportPath).toBe(join(dataDir, LEGACY_REMOTE_NETWORK_EXPORT_FILE))
    expect(result.removedProjectionSessions).toBe(1)
    expect(result.removedRemoteWorkspaces).toBe(1)

    // Export file exists with restrictive permissions and sanitized content.
    const exportStat = statSync(result.exportPath!)
    expect(exportStat.mode & 0o777).toBe(0o600)
    const exported = JSON.parse(readFileSync(result.exportPath!, 'utf8'))
    expect(exported.version).toBe(1)
    expect(exported.remoteHosts).toHaveLength(1)
    expect(exported.remoteHosts[0].displayName).toBe('Office box')
    expect(exported.remoteHosts[0].connectionConfig.transport).toBe('relay')
    expect(exported.relayHostEnrollments[0].roomId).toBe('room-1')
    expect(exported.relayServers[0].displayName).toBe('Default relay')
    const rawExport = readFileSync(result.exportPath!, 'utf8')
    expect(rawExport).not.toContain('shh')
    expect(rawExport).not.toContain('hunter2')
    expect(rawExport).not.toContain('sec-1')
    expect(rawExport).not.toContain('PAIR-1234')

    // Local entities survive; remote projections and mounted workspaces are gone.
    const workspaces = db.all<{ id: string }>(sql`SELECT id FROM workspaces`)
    const sessions = db.all<{ id: string }>(sql`SELECT id FROM sessions`)
    expect(workspaces.map(row => row.id)).toEqual(['ws-local'])
    expect(sessions.map(row => row.id)).toEqual(['session-local'])

    // Legacy tables remain for the Drizzle drop migration; apply its statements.
    db.run(sql`DROP TABLE remote_session_links`)
    db.run(sql`DROP TABLE relay_host_enrollments`)
    db.run(sql`DROP TABLE remote_hosts`)
    db.run(sql`DROP TABLE relay_servers`)
    const remaining = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).map(row => row.name)
    for (const table of ['remote_hosts', 'remote_session_links', 'relay_host_enrollments', 'relay_servers']) {
      expect(remaining).not.toContain(table)
    }
  })

  it('is a no-op when legacy tables are absent', () => {
    const dataDir = makeDataDir()
    const db = drizzle(new Database(join(dataDir, 'cradle.db')))
    db.run(sql`CREATE TABLE workspaces (id text PRIMARY KEY)`)

    const result = runLegacyRemoteNetworkCleanup(db, dataDir, silentLogger)

    expect(result).toEqual({
      exportPath: null,
      removedProjectionSessions: 0,
      removedRemoteWorkspaces: 0,
    })
  })
})
