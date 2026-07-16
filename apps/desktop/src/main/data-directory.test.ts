import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  completeDesktopDataMigrationAfterHealthyStart,
  getDesktopDataDirectoryState,
  initializeDesktopDataDirectory,
  rollbackDesktopDataMigrationAfterHealthFailure,
  runPendingDesktopDataMigration,
  scheduleDesktopDataDirectoryMigration,
  validateDesktopDataDirectoryTarget,
} from './data-directory'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => name === 'exe' ? '/Applications/Cradle.app/Cradle' : '/tmp/cradle-user-data'),
  },
}))

const roots: string[] = []

function createFixture(): { fixture: string, bootstrapRoot: string, installDirectory: string } {
  const fixture = mkdtempSync(join(tmpdir(), 'cradle-data-directory-'))
  roots.push(fixture)
  const bootstrapRoot = join(fixture, 'bootstrap-root')
  const installDirectory = join(fixture, 'application')
  mkdirSync(join(bootstrapRoot, 'data'), { recursive: true })
  mkdirSync(installDirectory, { recursive: true })
  return { fixture, bootstrapRoot, installDirectory }
}

afterEach(() => {
  for (const root of roots.splice(0)) { rmSync(root, { recursive: true, force: true }) }
})

describe('desktop data directory resolver', () => {
  it('falls back to the default root for missing and malformed pointers', async () => {
    const { bootstrapRoot, installDirectory } = createFixture()
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    expect(getDesktopDataDirectoryState()).toMatchObject({
      serverDataRoot: join(bootstrapRoot, 'data'),
      source: 'default',
    })

    mkdirSync(join(bootstrapRoot, 'bootstrap'), { recursive: true })
    writeFileSync(join(bootstrapRoot, 'bootstrap/data-root.json'), '{broken')
    await expect(initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })).resolves.toMatchObject({
      serverDataRoot: join(bootstrapRoot, 'data'),
      source: 'default',
    })
  })

  it('loads a normalized absolute custom root from the versioned pointer', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const customRoot = join(fixture, 'custom', '..', 'custom')
    mkdirSync(join(bootstrapRoot, 'bootstrap'), { recursive: true })
    writeFileSync(join(bootstrapRoot, 'bootstrap/data-root.json'), JSON.stringify({
      schemaVersion: 1,
      root: customRoot,
      migrationId: 'migration-1',
      lastSuccessAt: new Date().toISOString(),
    }))

    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    expect(getDesktopDataDirectoryState()).toMatchObject({
      serverDataRoot: join(fixture, 'custom'),
      source: 'custom',
    })
  })

  it('rejects relative, overlapping, install-owned, and non-empty targets', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const sourceSentinel = join(bootstrapRoot, 'data', 'cradle.db')
    writeFileSync(sourceSentinel, 'source-data')
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })

    await expect(validateDesktopDataDirectoryTarget('relative/path')).rejects.toThrow('absolute')
    await expect(validateDesktopDataDirectoryTarget('E:\\CradleData')).rejects.toThrow('absolute')
    await expect(validateDesktopDataDirectoryTarget(join(bootstrapRoot, 'data', 'nested'))).rejects.toThrow('inside')
    await expect(validateDesktopDataDirectoryTarget(join(installDirectory, 'data'))).rejects.toThrow('install')
    await expect(validateDesktopDataDirectoryTarget('/')).rejects.toThrow('filesystem or drive root')
    await expect(validateDesktopDataDirectoryTarget(fixture)).rejects.toThrow('contain the application install directory')
    const nonEmpty = join(fixture, 'non-empty')
    mkdirSync(nonEmpty)
    writeFileSync(join(nonEmpty, 'user-file.txt'), 'keep')
    await expect(validateDesktopDataDirectoryTarget(nonEmpty)).rejects.toThrow('empty')
    expect(readFileSync(join(nonEmpty, 'user-file.txt'), 'utf8')).toBe('keep')
    expect(readFileSync(sourceSentinel, 'utf8')).toBe('source-data')
  })

  it('recovers a crash after pointer replacement without losing the live pointer', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const oldRoot = join(fixture, 'old-data')
    const newRoot = join(fixture, 'new-data')
    mkdirSync(oldRoot, { recursive: true })
    mkdirSync(newRoot, { recursive: true })
    const bootstrapDirectory = join(bootstrapRoot, 'bootstrap')
    mkdirSync(bootstrapDirectory, { recursive: true })
    const oldPointer = {
      schemaVersion: 1,
      root: oldRoot,
      migrationId: 'old-migration',
      lastSuccessAt: null,
    }
    writeFileSync(join(bootstrapDirectory, 'data-root.json'), JSON.stringify({
      ...oldPointer,
      root: newRoot,
      migrationId: 'new-migration',
    }))
    writeFileSync(join(bootstrapDirectory, 'data-root.json.bak.pending'), JSON.stringify(oldPointer))

    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    expect(getDesktopDataDirectoryState()).toMatchObject({ serverDataRoot: newRoot, source: 'custom' })
    expect(readFileSync(join(bootstrapDirectory, 'data-root.json.bak'), 'utf8')).toBe(JSON.stringify(oldPointer))
    expect(existsSync(join(bootstrapDirectory, 'data-root.json'))).toBe(true)
    expect(existsSync(join(bootstrapDirectory, 'data-root.json.bak.pending'))).toBe(false)
  })

  it('restores the pending known-good pointer if an interrupted write has no live pointer', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const oldRoot = join(fixture, 'old-data')
    mkdirSync(oldRoot, { recursive: true })
    const bootstrapDirectory = join(bootstrapRoot, 'bootstrap')
    mkdirSync(bootstrapDirectory, { recursive: true })
    writeFileSync(join(bootstrapDirectory, 'data-root.json.bak.pending'), JSON.stringify({
      schemaVersion: 1,
      root: oldRoot,
      migrationId: 'old-migration',
      lastSuccessAt: null,
    }))

    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    expect(getDesktopDataDirectoryState()).toMatchObject({ serverDataRoot: oldRoot, source: 'custom' })
    expect(existsSync(join(bootstrapDirectory, 'data-root.json'))).toBe(true)
    expect(existsSync(join(bootstrapDirectory, 'data-root.json.bak.pending'))).toBe(false)
  })
})

describe('desktop data directory migration', () => {
  it('copies hidden and nested files, verifies them, and keeps the source until health succeeds', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const sourceRoot = join(bootstrapRoot, 'data')
    const targetRoot = join(fixture, 'moved-data')
    mkdirSync(join(sourceRoot, 'preferences'), { recursive: true })
    writeFileSync(join(sourceRoot, '.hidden'), 'hidden')
    writeFileSync(join(sourceRoot, 'cradle.db'), 'database')
    writeFileSync(join(sourceRoot, 'server-auth-token'), 'token')
    writeFileSync(join(sourceRoot, 'preferences/desktop.json'), '{}')
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })

    await scheduleDesktopDataDirectoryMigration(targetRoot)
    await expect(runPendingDesktopDataMigration()).resolves.toEqual({ migrated: true, failed: false })
    expect(existsSync(sourceRoot)).toBe(true)
    expect(readFileSync(join(targetRoot, '.hidden'), 'utf8')).toBe('hidden')
    expect(readFileSync(join(targetRoot, 'preferences/desktop.json'), 'utf8')).toBe('{}')
    expect(getDesktopDataDirectoryState()).toMatchObject({ serverDataRoot: targetRoot, source: 'custom' })

    const completed = await completeDesktopDataMigrationAfterHealthyStart()
    expect(completed?.phase).toBe('completed')
    expect(completed?.backupRoot).toContain('.bak-')
    expect(existsSync(sourceRoot)).toBe(false)
    expect(existsSync(completed!.backupRoot!)).toBe(true)
    expect(existsSync(targetRoot)).toBe(true)
  })

  it('restores the old pointer and leaves both roots intact when new-root health fails', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const sourceRoot = join(bootstrapRoot, 'data')
    const targetRoot = join(fixture, 'moved-data')
    writeFileSync(join(sourceRoot, 'cradle.db'), 'database')
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    await scheduleDesktopDataDirectoryMigration(targetRoot)
    await runPendingDesktopDataMigration()

    await rollbackDesktopDataMigrationAfterHealthFailure('server failed readiness')
    expect(getDesktopDataDirectoryState()).toMatchObject({ serverDataRoot: sourceRoot, source: 'default' })
    expect(getDesktopDataDirectoryState().pendingMigration).toMatchObject({
      phase: 'failed',
      errorMessage: 'server failed readiness',
    })
    expect(existsSync(sourceRoot)).toBe(true)
    expect(existsSync(targetRoot)).toBe(true)

    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    expect(getDesktopDataDirectoryState().serverDataRoot).toBe(sourceRoot)
  })

  it('rolls back an interrupted post-switch migration on the next startup', async () => {
    const { fixture, bootstrapRoot, installDirectory } = createFixture()
    const sourceRoot = join(bootstrapRoot, 'data')
    const targetRoot = join(fixture, 'moved-data')
    writeFileSync(join(sourceRoot, 'cradle.db'), 'database')
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    await scheduleDesktopDataDirectoryMigration(targetRoot)
    await runPendingDesktopDataMigration()

    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    await expect(runPendingDesktopDataMigration()).resolves.toMatchObject({ failed: true })
    expect(getDesktopDataDirectoryState().serverDataRoot).toBe(sourceRoot)
    expect(existsSync(sourceRoot)).toBe(true)
  })
})
