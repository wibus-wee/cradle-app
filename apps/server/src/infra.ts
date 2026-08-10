import type { dbSchema } from '@cradle/db'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { ServerBootstrapReporter } from './bootstrap-lifecycle'
import type { ServerConfigValues } from './config/server-config'
import { ServerConfig } from './config/server-config'
import { DatabaseConfig } from './database/database.config'
import type { DatabaseCompactionResult } from './database/database.provider'
import { DbProvider } from './database/database.provider'
import { MigrationRunner } from './database/migration-runner'
import type { Logger } from './logging/logger'
import { getLogger as getLoggerFromModule } from './logging/logger'

let _serverConfig: ServerConfig | undefined
let _logger: Logger | undefined
let _dbProvider: DbProvider | undefined
let _infraEnv: InfraEnvSnapshot | undefined
const beforeDatabaseShutdownHooks = new Set<() => void>()

interface InfraEnvSnapshot {
  host?: string
  port?: string
  logLevel?: string
  dataDir?: string
  dbPath?: string
  migrationsDir?: string
  logFile?: string
  authToken?: string
  authRequired?: string
}

function readInfraEnv(): InfraEnvSnapshot {
  return {
    host: process.env.CRADLE_HOST,
    port: process.env.CRADLE_PORT,
    logLevel: process.env.CRADLE_LOG_LEVEL,
    dataDir: process.env.CRADLE_DATA_DIR,
    dbPath: process.env.CRADLE_DB_PATH,
    migrationsDir: process.env.CRADLE_MIGRATIONS_DIR,
    logFile: process.env.CRADLE_LOG_FILE,
    authToken: process.env.CRADLE_AUTH_TOKEN,
    authRequired: process.env.CRADLE_AUTH_REQUIRED,
  }
}

function isSameInfraEnv(a: InfraEnvSnapshot, b: InfraEnvSnapshot): boolean {
  return (
    a.host === b.host
    && a.port === b.port
    && a.logLevel === b.logLevel
    && a.dataDir === b.dataDir
    && a.dbPath === b.dbPath
    && a.migrationsDir === b.migrationsDir
    && a.logFile === b.logFile
    && a.authToken === b.authToken
    && a.authRequired === b.authRequired
  )
}

function clearCachedInfra(): void {
  const provider = _dbProvider
  const failures: Error[] = []
  if (provider) {
    for (const hook of beforeDatabaseShutdownHooks) {
      try {
        hook()
      }
      catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    try {
      provider.onApplicationShutdown()
    }
    catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  _dbProvider = undefined
  _serverConfig = undefined
  _logger = undefined
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to flush database-owned runtime state')
  }
}

/**
 * Register a synchronous durability hook that runs immediately before the
 * current SQLite connection closes. Feature modules use this to drain
 * write-behind journals without making infrastructure depend on them.
 */
export function registerBeforeDatabaseShutdown(hook: () => void): () => void {
  beforeDatabaseShutdownHooks.add(hook)
  return () => beforeDatabaseShutdownHooks.delete(hook)
}

function refreshInfraForEnv(): void {
  const nextEnv = readInfraEnv()
  if (!_infraEnv) {
    _infraEnv = nextEnv
    return
  }

  if (isSameInfraEnv(_infraEnv, nextEnv)) {
    return
  }

  clearCachedInfra()
  _infraEnv = nextEnv
}

export function getServerConfig(): ServerConfigValues {
  refreshInfraForEnv()
  _serverConfig ??= new ServerConfig()
  return _serverConfig.get()
}

export function getLogger(): Logger {
  refreshInfraForEnv()
  _logger ??= getLoggerFromModule()
  return _logger
}

function ensureDbProvider(bootstrapReporter?: ServerBootstrapReporter): DbProvider {
  refreshInfraForEnv()
  if (!_dbProvider) {
    const sc = _serverConfig ?? (_serverConfig = new ServerConfig())
    const dbConfig = new DatabaseConfig(sc)
    _dbProvider = new DbProvider(dbConfig)
    new MigrationRunner(_dbProvider, dbConfig, getLogger(), bootstrapReporter).onModuleInit()
  }
  return _dbProvider
}

/** Return the raw drizzle database instance — the one thing services actually need. */
export function db(): BetterSQLite3Database<typeof dbSchema> {
  return ensureDbProvider().getDb()
}

/** Initialize the database before other bootstrap services acquire it lazily. */
export function initializeDatabase(bootstrapReporter?: ServerBootstrapReporter): void {
  ensureDbProvider(bootstrapReporter)
}

export function compactDatabase(): DatabaseCompactionResult {
  return ensureDbProvider().compactDatabase()
}

/** Gracefully close the database and clear all cached singletons. */
export function shutdownInfra(): void {
  clearCachedInfra()
  _infraEnv = undefined
}
