import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { sessions } from '@cradle/db'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import type { DatabaseConfig } from '../src/database/database.config'
import {
  DbProvider,
  nodeDatabaseFileOperations,
} from '../src/database/database.provider'
import { db, shutdownInfra } from '../src/infra'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

function readMigrationStatements(name: string): string[] {
  const path = resolve(process.cwd(), '../../packages/db/drizzle', name)
  return readFileSync(path, 'utf8')
    .split('--> statement-breakpoint')
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0)
}

function databaseConfigForPath(dbPath: string): DatabaseConfig {
  return {
    getOptions: () => ({
      dbPath,
      dataDir: join(dbPath, '..'),
      migrationsDir: resolve(process.cwd(), '../../packages/db/drizzle'),
    }),
  } as DatabaseConfig
}

function seedCompactionFixture(provider: DbProvider): void {
  const database = provider.getDb()
  database.run(sql`
    CREATE TABLE compaction_fixture (
      id integer PRIMARY KEY,
      payload blob NOT NULL
    )
  `)
  database.run(sql`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < 1200
    )
    INSERT INTO compaction_fixture (id, payload)
    SELECT value, randomblob(4096) FROM sequence
  `)
  database.run(sql`DELETE FROM compaction_fixture WHERE id <= 1000`)
}

function countRows(
  sqlite: Database.Database,
  table: 'sessions' | 'issue_statuses' | 'issues' | 'chat_message_payloads',
): number {
  const statement = table === 'sessions'
    ? 'SELECT count(*) AS count FROM sessions'
    : table === 'issue_statuses'
      ? 'SELECT count(*) AS count FROM issue_statuses'
      : table === 'issues'
        ? 'SELECT count(*) AS count FROM issues'
        : 'SELECT count(*) AS count FROM chat_message_payloads'
  const row = sqlite.prepare(statement).get() as { count: number }
  return row.count
}

describe('database module', () => {
  it('runs migrations on startup', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    try {
      // Initialize server app to trigger DB setup
      await createServerApp()
      const d = db()
      const rows = d.select().from(sessions).limit(1).all()
      expect(rows).toEqual([])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('migrates workspace locators without cascading workspace children', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    try {
      sqlite.exec(`
        CREATE TABLE workspaces (
          id text PRIMARY KEY NOT NULL,
          name text NOT NULL,
          path text NOT NULL,
          identifier text DEFAULT '' NOT NULL,
          pinned integer DEFAULT 0 NOT NULL,
          created_at integer DEFAULT (unixepoch()) NOT NULL,
          updated_at integer DEFAULT (unixepoch()) NOT NULL
        );
        CREATE UNIQUE INDEX workspaces_path_unique ON workspaces (path);

        CREATE TABLE sessions (
          id text PRIMARY KEY NOT NULL,
          workspace_id text,
          title text NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
        );

        CREATE TABLE issue_statuses (
          id text PRIMARY KEY NOT NULL,
          workspace_id text NOT NULL,
          name text NOT NULL,
          category text NOT NULL,
          position integer NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
        );

        CREATE TABLE issues (
          id text PRIMARY KEY NOT NULL,
          workspace_id text NOT NULL,
          status_id text NOT NULL,
          title text NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade,
          FOREIGN KEY (status_id) REFERENCES issue_statuses(id) ON DELETE restrict
        );
      `)
      sqlite.prepare(`
        INSERT INTO workspaces (id, name, path, identifier, pinned)
        VALUES ('workspace_1', 'Workspace', '/tmp/cradle-old', 'CRA', 1)
      `).run()
      sqlite.prepare(`
        INSERT INTO sessions (id, workspace_id, title)
        VALUES ('session_1', 'workspace_1', 'Chat')
      `).run()
      sqlite.prepare(`
        INSERT INTO issue_statuses (id, workspace_id, name, category, position)
        VALUES ('status_1', 'workspace_1', 'Backlog', 'backlog', 0)
      `).run()
      sqlite.prepare(`
        INSERT INTO issues (id, workspace_id, status_id, title)
        VALUES ('issue_1', 'workspace_1', 'status_1', 'Issue')
      `).run()

      const runMigration = sqlite.transaction(() => {
        for (const name of ['0013_host_scoped_workspaces.sql', '0061_workspace_locator_node_id.sql']) {
          for (const statement of readMigrationStatements(name)) {
            sqlite.exec(statement)
          }
        }
      })
      runMigration()

      const workspace = sqlite.prepare(`
        SELECT id, name, locator_json AS locatorJson, git_identity_json AS gitIdentityJson, identifier, pinned
        FROM workspaces
      `).get() as {
        id: string
        name: string
        locatorJson: string
        gitIdentityJson: string
        identifier: string
        pinned: number
      }
      const columns = sqlite.prepare('PRAGMA table_info(workspaces)').all() as Array<{
        name: string
        notnull: number
      }>

      expect(workspace).toEqual({
        id: 'workspace_1',
        name: 'Workspace',
        locatorJson: '{"path":"/tmp/cradle-old","nodeId":"local"}',
        gitIdentityJson: '{}',
        identifier: 'CRA',
        pinned: 1,
      })
      expect(columns.some(column => column.name === 'path')).toBe(false)
      expect(columns.find(column => column.name === 'locator_json')?.notnull).toBe(1)
      expect(countRows(sqlite, 'sessions')).toBe(1)
      expect(countRows(sqlite, 'issue_statuses')).toBe(1)
      expect(countRows(sqlite, 'issues')).toBe(1)
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    }
    finally {
      sqlite.close()
    }
  })

  it('normalizes historical chat payloads without breaking message references', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const now = Date.now()

    try {
      sqlite.exec(`
        CREATE TABLE sessions (
          id text PRIMARY KEY NOT NULL
        );

        CREATE TABLE messages (
          id text PRIMARY KEY NOT NULL,
          session_id text NOT NULL,
          parent_message_id text,
          parent_tool_call_id text,
          task_id text,
          depth integer DEFAULT 0 NOT NULL,
          role text NOT NULL,
          status text DEFAULT 'complete' NOT NULL,
          content text NOT NULL,
          message_json text NOT NULL,
          error_text text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE cascade
        );

        CREATE TABLE usage_logs (
          id text PRIMARY KEY NOT NULL,
          message_id text REFERENCES messages(id) ON DELETE set null
        );

        CREATE TABLE session_events (
          sequence_id integer PRIMARY KEY AUTOINCREMENT,
          aggregate_id text NOT NULL,
          aggregate_type text DEFAULT 'ChatSession' NOT NULL,
          version integer NOT NULL,
          event_type text NOT NULL,
          payload text DEFAULT '{}' NOT NULL,
          occurred_at integer NOT NULL
        );

        CREATE TABLE backend_run_snapshots (
          id text PRIMARY KEY NOT NULL,
          status text NOT NULL,
          started_at integer NOT NULL,
          completed_at integer
        );

        CREATE TABLE backend_run_snapshot_events (
          id text PRIMARY KEY NOT NULL,
          snapshot_id text NOT NULL,
          chunk_type text,
          payload_json text NOT NULL,
          FOREIGN KEY (snapshot_id) REFERENCES backend_run_snapshots(id) ON DELETE cascade
        );
      `)

      sqlite.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-1')
      sqlite.prepare(`
        INSERT INTO messages (
          id, session_id, parent_message_id, parent_tool_call_id, task_id, depth,
          role, status, content, message_json, error_text, created_at, updated_at
        ) VALUES (?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        'user-current',
        'session-1',
        'user',
        'complete',
        'current message',
        JSON.stringify({ id: 'user-current', role: 'user', parts: [{ type: 'text', text: 'current message' }] }),
        100,
        101,
      )
      sqlite.prepare('INSERT INTO usage_logs (id, message_id) VALUES (?, ?)')
        .run('usage-1', 'user-current')

      const insertEvent = sqlite.prepare(`
        INSERT INTO session_events (
          aggregate_id, aggregate_type, version, event_type, payload, occurred_at
        ) VALUES (?, 'ChatSession', ?, ?, ?, ?)
      `)
      insertEvent.run('session-1', 1, 'UserMessageAppended', JSON.stringify({
        message: {
          id: 'user-current',
          sessionId: 'session-1',
          role: 'user',
          status: 'complete',
          content: 'current message',
          messageJson: JSON.stringify({ id: 'user-current', role: 'user' }),
          errorText: null,
          createdAt: 100,
          updatedAt: 101,
        },
      }), 101)
      insertEvent.run('session-1', 2, 'AssistantMessageCompleted', JSON.stringify({
        message: {
          id: 'assistant-rolled-back',
          sessionId: 'session-1',
          role: 'assistant',
          status: 'complete',
          content: 'historical answer',
          messageJson: JSON.stringify({ id: 'assistant-rolled-back', role: 'assistant' }),
          errorText: null,
          createdAt: 110,
          updatedAt: 120,
        },
      }), 120)
      insertEvent.run('session-1', 3, 'SessionArchived', JSON.stringify({
        sessionId: 'session-1',
        archivedAt: 130,
      }), 130)
      insertEvent.run('deleted-session', 1, 'UserMessageAppended', JSON.stringify({
        message: {
          id: 'deleted-session-message',
          sessionId: 'deleted-session',
          role: 'user',
          status: 'complete',
          content: 'orphaned historical message',
          messageJson: JSON.stringify({ id: 'deleted-session-message', role: 'user' }),
          errorText: null,
          createdAt: 90,
          updatedAt: 91,
        },
      }), 91)

      const insertSnapshot = sqlite.prepare(`
        INSERT INTO backend_run_snapshots (id, status, started_at, completed_at)
        VALUES (?, ?, ?, ?)
      `)
      insertSnapshot.run('snapshot-success', 'complete', now - 1_000, now - 500)
      insertSnapshot.run('snapshot-failure', 'failed', now - 1_000, now - 500)
      insertSnapshot.run('snapshot-old-success', 'complete', 1, 1)
      insertSnapshot.run('snapshot-old-failure', 'failed', 1, 1)
      sqlite.prepare(`
        INSERT INTO backend_run_snapshot_events (id, snapshot_id, chunk_type, payload_json)
        VALUES (?, ?, ?, ?)
      `).run(
        'snapshot-event-success',
        'snapshot-success',
        'tool_call_output_available',
        JSON.stringify({ coalescedCount: 2, output: 'large successful output' }),
      )
      sqlite.prepare(`
        INSERT INTO backend_run_snapshot_events (id, snapshot_id, chunk_type, payload_json)
        VALUES (?, ?, ?, ?)
      `).run(
        'snapshot-event-failure',
        'snapshot-failure',
        'tool_call_output_available',
        JSON.stringify({ output: 'diagnostic failure output' }),
      )

      const runMigrations = sqlite.transaction(() => {
        for (const migration of ['0037_messy_proudstar.sql', '0038_sharp_mastermind.sql']) {
          for (const statement of readMigrationStatements(migration)) {
            sqlite.exec(statement)
          }
        }
      })
      runMigrations()

      expect(countRows(sqlite, 'chat_message_payloads')).toBe(2)
      expect(sqlite.prepare(`
        SELECT id, session_id AS sessionId, content, message_json AS messageJson,
          error_text AS errorText, created_at AS createdAt, updated_at AS updatedAt
        FROM chat_message_payloads
        ORDER BY id
      `).all()).toEqual([
        {
          id: 'assistant-rolled-back',
          sessionId: 'session-1',
          content: 'historical answer',
          messageJson: JSON.stringify({ id: 'assistant-rolled-back', role: 'assistant' }),
          errorText: null,
          createdAt: 110,
          updatedAt: 120,
        },
        {
          id: 'user-current',
          sessionId: 'session-1',
          content: 'current message',
          messageJson: JSON.stringify({ id: 'user-current', role: 'user', parts: [{ type: 'text', text: 'current message' }] }),
          errorText: null,
          createdAt: 100,
          updatedAt: 101,
        },
      ])

      const messageColumns = sqlite.prepare('PRAGMA table_info(messages)').all() as Array<{
        name: string
      }>
      expect(messageColumns.map(column => column.name)).not.toContain('content')
      expect(messageColumns.map(column => column.name)).not.toContain('message_json')
      expect(messageColumns.map(column => column.name)).not.toContain('error_text')
      expect(sqlite.prepare('SELECT id, payload_id AS payloadId FROM messages').get()).toEqual({
        id: 'user-current',
        payloadId: 'user-current',
      })
      expect(sqlite.prepare('SELECT message_id AS messageId FROM usage_logs').get()).toEqual({
        messageId: 'user-current',
      })
      expect(sqlite.prepare(`
        SELECT count(*) AS count
        FROM session_events
        WHERE aggregate_id = 'deleted-session'
      `).get()).toEqual({ count: 0 })

      const storedEvents = sqlite.prepare(`
        SELECT event_type AS eventType, payload
        FROM session_events
        ORDER BY sequence_id
      `).all() as Array<{ eventType: string, payload: string }>
      for (const event of storedEvents) {
        expect(event.payload).not.toContain('content')
        expect(event.payload).not.toContain('messageJson')
        expect(event.payload).not.toContain('errorText')
        expect(JSON.parse(event.payload).v).toBe(4)
      }
      expect(JSON.parse(storedEvents[0]!.payload).message.payloadId).toBe('user-current')
      expect(JSON.parse(storedEvents[1]!.payload).message.payloadId).toBe('assistant-rolled-back')

      expect(JSON.parse((sqlite.prepare(`
        SELECT payload_json AS payloadJson
        FROM backend_run_snapshot_events
        WHERE id = 'snapshot-event-success'
      `).get() as { payloadJson: string }).payloadJson)).toEqual({
        schema: 'cradle.run-snapshot-success-metadata.v1',
        originalLength: JSON.stringify({ coalescedCount: 2, output: 'large successful output' }).length,
        coalescedCount: 2,
      })
      expect(JSON.parse((sqlite.prepare(`
        SELECT payload_json AS payloadJson
        FROM backend_run_snapshot_events
        WHERE id = 'snapshot-event-failure'
      `).get() as { payloadJson: string }).payloadJson)).toEqual({
        output: 'diagnostic failure output',
      })
      expect(sqlite.prepare(`
        SELECT id FROM backend_run_snapshots
        WHERE id IN ('snapshot-old-success', 'snapshot-old-failure')
      `).all()).toEqual([])
      expect(sqlite.prepare(`
        SELECT status FROM database_maintenance_tasks
        WHERE id = 'compact-chat-storage-v1'
      `).get()).toEqual({ status: 'pending' })
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    }
    finally {
      sqlite.close()
    }
  })

  it('compacts a database into an integrity-checked incremental-auto-vacuum replacement', () => {
    const dataDir = makeTempDataDir()
    const dbPath = join(dataDir, 'compact-success.db')
    const provider = new DbProvider(databaseConfigForPath(dbPath))

    try {
      seedCompactionFixture(provider)

      const result = provider.compactDatabase()

      expect(result.status).toBe('completed')
      if (result.status !== 'completed') {
        throw new Error(`Expected completed compaction, received ${result.status}`)
      }
      expect(result.bytesAfter).toBeLessThan(result.bytesBefore)
      expect(provider.getDb().get<{ count: number }>(sql`
        SELECT count(*) AS count FROM compaction_fixture
      `)).toEqual({ count: 200 })
      expect(provider.getDb().get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`))
        .toEqual({ auto_vacuum: 2 })
      expect(existsSync(`${dbPath}.compact.tmp`)).toBe(false)
      expect(existsSync(`${dbPath}.compact.backup`)).toBe(false)
    }
    finally {
      provider.onApplicationShutdown()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('defers physical compaction without touching the database when space is insufficient', () => {
    const dataDir = makeTempDataDir()
    const dbPath = join(dataDir, 'compact-deferred.db')
    const provider = new DbProvider(databaseConfigForPath(dbPath), {
      ...nodeDatabaseFileOperations,
      availableBytes: () => 0,
    })

    try {
      seedCompactionFixture(provider)

      expect(provider.compactDatabase()).toEqual({
        status: 'deferred',
        reason: 'insufficient_space',
      })
      expect(provider.getDb().get<{ count: number }>(sql`
        SELECT count(*) AS count FROM compaction_fixture
      `)).toEqual({ count: 200 })
      expect(existsSync(`${dbPath}.compact.tmp`)).toBe(false)
      expect(existsSync(`${dbPath}.compact.backup`)).toBe(false)
    }
    finally {
      provider.onApplicationShutdown()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('restores and reopens the original database when atomic replacement fails', () => {
    const dataDir = makeTempDataDir()
    const dbPath = join(dataDir, 'compact-rollback.db')
    const provider = new DbProvider(databaseConfigForPath(dbPath), {
      ...nodeDatabaseFileOperations,
      rename: (source, destination) => {
        if (source === `${dbPath}.compact.tmp` && destination === dbPath) {
          throw new Error('injected replacement failure')
        }
        nodeDatabaseFileOperations.rename(source, destination)
      },
    })

    try {
      seedCompactionFixture(provider)

      expect(() => provider.compactDatabase()).toThrow(
        `Failed to replace compacted database at ${dbPath}`,
      )
      expect(provider.getDb().get<{ count: number }>(sql`
        SELECT count(*) AS count FROM compaction_fixture
      `)).toEqual({ count: 200 })
      expect(existsSync(`${dbPath}.compact.tmp`)).toBe(false)
      expect(existsSync(`${dbPath}.compact.backup`)).toBe(false)
    }
    finally {
      provider.onApplicationShutdown()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
