import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { sessions } from '@cradle/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
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

function countRows(sqlite: Database.Database, table: 'sessions' | 'issue_statuses' | 'issues'): number {
  const statement = table === 'sessions'
    ? 'SELECT count(*) AS count FROM sessions'
    : table === 'issue_statuses'
      ? 'SELECT count(*) AS count FROM issue_statuses'
      : 'SELECT count(*) AS count FROM issues'
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
        for (const statement of readMigrationStatements('0013_host_scoped_workspaces.sql')) {
          sqlite.exec(statement)
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
        locatorJson: '{"hostId":"local","path":"/tmp/cradle-old"}',
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
})
