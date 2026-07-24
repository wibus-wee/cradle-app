import type { dbSchema } from '@cradle/db'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { ServerConfigValues } from './config/server-config'
import { ServerConfig } from './config/server-config'
import { DatabaseConfig } from './database/database.config'
import { DbProvider } from './database/database.provider'
import { MigrationRunner } from './database/migration-runner'
import type { Logger } from './logging/logger'
import { getLogger as getLoggerFromModule } from './logging/logger'

let _serverConfig: ServerConfig | undefined
let _logger: Logger | undefined
let _dbProvider: DbProvider | undefined
let _infraEnv: InfraEnvSnapshot | undefined

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
  _dbProvider?.onApplicationShutdown()
  _dbProvider = undefined
  _serverConfig = undefined
  _logger = undefined
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

function ensureDbProvider(): DbProvider {
  refreshInfraForEnv()
  if (!_dbProvider) {
    const sc = _serverConfig ?? (_serverConfig = new ServerConfig())
    const dbConfig = new DatabaseConfig(sc)
    _dbProvider = new DbProvider(dbConfig)
    new MigrationRunner(_dbProvider, dbConfig, getLogger()).onModuleInit()
  }
  return _dbProvider
}

/** Return the raw drizzle database instance — the one thing services actually need. */
export function db(): BetterSQLite3Database<typeof dbSchema> {
  return ensureDbProvider().getDb()
}

/** Gracefully close the database and clear all cached singletons. */
export function shutdownInfra(): void {
  clearCachedInfra()
  _infraEnv = undefined
}
