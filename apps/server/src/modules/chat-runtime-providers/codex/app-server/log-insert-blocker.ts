import { existsSync } from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import { isAppFeatureFlagEnabled } from '../../../preferences/service'
import { resolveCodexAppServerHome } from './runtime-home'

export const CODEX_APP_SERVER_LOG_INSERT_BLOCKER_TRIGGER = 'block_log_inserts'
const CODEX_APP_SERVER_LOG_DATABASE_NAME = 'logs_2.sqlite'

export type CodexAppServerLogInsertBlockerStatus
  = | 'applied'
    | 'dropped'
    | 'missing-database'
    | 'missing-logs-table'
    | 'failed'

export interface CodexAppServerLogInsertBlockerResult {
  databasePath: string
  enabled: boolean
  status: CodexAppServerLogInsertBlockerStatus
  error?: string
}

export function resolveCodexAppServerLogDatabasePath(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  return join(resolveCodexAppServerHome(input), CODEX_APP_SERVER_LOG_DATABASE_NAME)
}

export function syncCodexAppServerLogInsertBlockerFromFeatureFlag(): CodexAppServerLogInsertBlockerResult {
  let enabled = false
  try {
    enabled = isAppFeatureFlagEnabled('blockCodexAppServerLogInserts')
    return setCodexAppServerLogInsertBlocker(enabled)
  }
  catch (error) {
    const result: CodexAppServerLogInsertBlockerResult = {
      databasePath: resolveCodexAppServerLogDatabasePath(),
      enabled,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
    console.warn('[codex-app-server] Failed to sync log insert blocker:', result)
    return result
  }
}

export function setCodexAppServerLogInsertBlocker(
  enabled: boolean,
  input: { databasePath?: string } = {},
): CodexAppServerLogInsertBlockerResult {
  const databasePath = input.databasePath ?? resolveCodexAppServerLogDatabasePath()
  if (!existsSync(databasePath)) {
    return { databasePath, enabled, status: 'missing-database' }
  }

  let db: Database.Database | null = null
  try {
    db = new Database(databasePath)
    db.pragma('busy_timeout = 1000')
    if (!enabled) {
      db.exec(`DROP TRIGGER IF EXISTS ${CODEX_APP_SERVER_LOG_INSERT_BLOCKER_TRIGGER}`)
      return { databasePath, enabled, status: 'dropped' }
    }

    const logsTable = db.prepare(
      'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'logs\'',
    ).get()
    if (!logsTable) {
      return { databasePath, enabled, status: 'missing-logs-table' }
    }

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${CODEX_APP_SERVER_LOG_INSERT_BLOCKER_TRIGGER}
      BEFORE INSERT ON logs
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `)
    return { databasePath, enabled, status: 'applied' }
  }
  catch (error) {
    return {
      databasePath,
      enabled,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  finally {
    db?.close()
  }
}
