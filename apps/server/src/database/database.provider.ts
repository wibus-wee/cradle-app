import {
  existsSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'

import { dbSchema } from '@cradle/db'
import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { DatabaseConfig } from './database.config'

export type DatabaseCompactionResult
  = | { status: 'completed', bytesBefore: number, bytesAfter: number }
    | { status: 'deferred', reason: 'insufficient_space' }
    | { status: 'not_applicable' }

export interface DatabaseFileOperations {
  exists: (path: string) => boolean
  remove: (path: string) => void
  rename: (source: string, destination: string) => void
  fileSize: (path: string) => number
  availableBytes: (path: string) => number
}

export const nodeDatabaseFileOperations: DatabaseFileOperations = {
  exists: path => existsSync(path),
  remove: path => rmSync(path, { force: true }),
  rename: (source, destination) => renameSync(source, destination),
  fileSize: path => statSync(path).size,
  availableBytes: (path) => {
    const stats = statfsSync(path, { bigint: true })
    const available = stats.bavail * stats.bsize
    return available > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(available)
  },
}

export class DbProvider {
  private sqlite?: Database.Database
  private db?: BetterSQLite3Database<typeof dbSchema>

  constructor(
    private readonly config: DatabaseConfig,
    private readonly fileOperations: DatabaseFileOperations = nodeDatabaseFileOperations,
  ) {}

  getDb(): BetterSQLite3Database<typeof dbSchema> {
    if (!this.db) {
      const { dbPath } = this.config.getOptions()
      try {
        this.recoverInterruptedCompaction(dbPath)
        this.openDatabase(dbPath)
      }
      catch (error) {
        this.closeDatabase()
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`Failed to open database at ${dbPath}: ${message}`, { cause: error })
      }
    }
    return this.db!
  }

  compactDatabase(): DatabaseCompactionResult {
    const { dbPath } = this.config.getOptions()
    if (dbPath === ':memory:' || !this.fileOperations.exists(dbPath)) {
      return { status: 'not_applicable' }
    }

    this.getDb()
    const sqlite = this.sqlite!
    this.assertHealthyDatabase(sqlite, dbPath)
    const checkpoint = sqlite.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>
    if (checkpoint.some(row => row.busy !== 0)) {
      throw new Error(`Failed to checkpoint database before compaction at ${dbPath}`)
    }

    const bytesBefore = this.fileOperations.fileSize(dbPath)
    if (this.fileOperations.availableBytes(dirname(dbPath)) < bytesBefore) {
      return { status: 'deferred', reason: 'insufficient_space' }
    }

    const temporaryPath = this.temporaryCompactionPath(dbPath)
    const backupPath = this.backupCompactionPath(dbPath)
    this.fileOperations.remove(temporaryPath)
    this.fileOperations.remove(backupPath)

    // The setting is applied to the VACUUM output even when the existing file
    // was created with auto_vacuum=NONE.
    sqlite.pragma('auto_vacuum = INCREMENTAL')
    sqlite.prepare('VACUUM INTO ?').run(temporaryPath)
    this.assertHealthyDatabaseFile(temporaryPath)
    const bytesAfter = this.fileOperations.fileSize(temporaryPath)

    this.closeDatabase()
    this.removeWalFiles(dbPath)
    let originalMoved = false
    try {
      this.fileOperations.rename(dbPath, backupPath)
      originalMoved = true
      this.fileOperations.rename(temporaryPath, dbPath)
      this.openDatabase(dbPath)
      this.assertHealthyDatabase(this.sqlite!, dbPath)
      this.fileOperations.remove(backupPath)
      return { status: 'completed', bytesBefore, bytesAfter }
    }
    catch (error) {
      this.closeDatabase()
      if (originalMoved) {
        this.fileOperations.remove(dbPath)
        this.fileOperations.rename(backupPath, dbPath)
      }
      this.fileOperations.remove(temporaryPath)
      this.removeWalFiles(dbPath)
      this.openDatabase(dbPath)
      throw new Error(`Failed to replace compacted database at ${dbPath}`, { cause: error })
    }
  }

  onApplicationShutdown(): void {
    this.closeDatabase()
  }

  private openDatabase(dbPath: string): void {
    const isNewDatabase = dbPath === ':memory:'
      || !this.fileOperations.exists(dbPath)
      || this.fileOperations.fileSize(dbPath) === 0
    this.sqlite = new Database(dbPath)
    if (isNewDatabase) {
      this.sqlite.pragma('auto_vacuum = INCREMENTAL')
    }
    this.sqlite.pragma('foreign_keys = ON')
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('busy_timeout = 5000')
    // NORMAL is the recommended durability tradeoff with WAL (vs FULL fsync on every commit).
    this.sqlite.pragma('synchronous = NORMAL')
    this.db = drizzle(this.sqlite, { schema: dbSchema })
  }

  private closeDatabase(): void {
    this.sqlite?.close()
    this.sqlite = undefined
    this.db = undefined
  }

  private recoverInterruptedCompaction(dbPath: string): void {
    if (dbPath === ':memory:') {
      return
    }
    const temporaryPath = this.temporaryCompactionPath(dbPath)
    const backupPath = this.backupCompactionPath(dbPath)
    const databaseExists = this.fileOperations.exists(dbPath)
    const backupExists = this.fileOperations.exists(backupPath)

    if (!databaseExists && backupExists) {
      this.removeWalFiles(dbPath)
      this.fileOperations.rename(backupPath, dbPath)
    }
    else if (databaseExists && backupExists) {
      try {
        this.assertHealthyDatabaseFile(dbPath)
        this.fileOperations.remove(backupPath)
      }
      catch {
        this.fileOperations.remove(dbPath)
        this.removeWalFiles(dbPath)
        this.fileOperations.rename(backupPath, dbPath)
      }
    }
    this.fileOperations.remove(temporaryPath)
  }

  private assertHealthyDatabaseFile(path: string): void {
    const sqlite = new Database(path, { readonly: true, fileMustExist: true })
    try {
      this.assertHealthyDatabase(sqlite, path)
    }
    finally {
      sqlite.close()
    }
  }

  private assertHealthyDatabase(sqlite: Database.Database, path: string): void {
    const rows = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed at ${path}`)
    }
  }

  private removeWalFiles(dbPath: string): void {
    this.fileOperations.remove(`${dbPath}-wal`)
    this.fileOperations.remove(`${dbPath}-shm`)
  }

  private temporaryCompactionPath(dbPath: string): string {
    return `${dbPath}.compact.tmp`
  }

  private backupCompactionPath(dbPath: string): string {
    return `${dbPath}.compact.backup`
  }
}
