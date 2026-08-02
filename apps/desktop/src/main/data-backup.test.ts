import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as tar from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  completeDesktopDataBackupAfterHealthyStart,
  getDesktopDataBackupStatus,
  initializeDesktopDataBackup,
  rollbackDesktopDataBackupAfterHealthFailure,
  runPendingDesktopDataBackup,
  scheduleDesktopDataBackupExport,
  scheduleDesktopDataBackupRestore,
} from './data-backup'
import { initializeDesktopDataDirectory } from './data-directory'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => name === 'exe' ? '/Applications/Cradle.app/Cradle' : '/tmp/cradle-user-data'),
  },
}))

const roots: string[] = []

async function createFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cradle-data-backup-'))
  roots.push(fixture)
  const bootstrapRoot = join(fixture, 'bootstrap-root')
  const dataRoot = join(bootstrapRoot, 'data')
  const installDirectory = join(fixture, 'application')
  mkdirSync(join(dataRoot, 'preferences'), { recursive: true })
  mkdirSync(installDirectory, { recursive: true })
  await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
  await initializeDesktopDataBackup()
  return {
    fixture,
    bootstrapRoot,
    installDirectory,
    dataRoot,
    archivePath: join(fixture, 'transfer.cradle-backup'),
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('desktop data backup', () => {
  it('exports and restores the complete Cradle data tree with checksum verification', async () => {
    const { bootstrapRoot, installDirectory, dataRoot, archivePath } = await createFixture()
    writeFileSync(join(dataRoot, 'cradle.db'), 'original-database')
    writeFileSync(join(dataRoot, '.hidden'), 'hidden')
    writeFileSync(join(dataRoot, 'preferences/desktop.json'), '{"theme":"dark"}')

    await scheduleDesktopDataBackupExport(archivePath)
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    await initializeDesktopDataBackup()
    await expect(runPendingDesktopDataBackup('1.2.3')).resolves.toEqual({
      exported: true,
      restored: false,
      failed: false,
    })
    expect(existsSync(archivePath)).toBe(true)
    expect(existsSync(join(dataRoot, '.cradle-data-backup.json'))).toBe(false)
    expect(getDesktopDataBackupStatus()).toMatchObject({
      kind: 'export',
      phase: 'completed',
      archivePath,
    })

    writeFileSync(join(dataRoot, 'cradle.db'), 'new-machine-database')
    rmSync(join(dataRoot, '.hidden'))
    await scheduleDesktopDataBackupRestore(archivePath)
    await initializeDesktopDataDirectory({ bootstrapRoot, installDirectory })
    await initializeDesktopDataBackup()
    await expect(runPendingDesktopDataBackup('1.2.3')).resolves.toEqual({
      exported: false,
      restored: true,
      failed: false,
    })
    expect(readFileSync(join(dataRoot, 'cradle.db'), 'utf8')).toBe('original-database')
    expect(readFileSync(join(dataRoot, '.hidden'), 'utf8')).toBe('hidden')
    expect(getDesktopDataBackupStatus()).toMatchObject({
      kind: 'restore',
      phase: 'health-check',
    })

    await completeDesktopDataBackupAfterHealthyStart()
    const completed = getDesktopDataBackupStatus()
    expect(completed.phase).toBe('completed')
    expect(completed.backupRoot).toContain('.before-restore-')
    expect(readFileSync(join(completed.backupRoot!, 'cradle.db'), 'utf8')).toBe('new-machine-database')
  })

  it('rolls back to the pre-restore data when startup health fails', async () => {
    const { dataRoot, archivePath } = await createFixture()
    writeFileSync(join(dataRoot, 'cradle.db'), 'backup-database')
    await scheduleDesktopDataBackupExport(archivePath)
    await runPendingDesktopDataBackup('1.2.3')

    writeFileSync(join(dataRoot, 'cradle.db'), 'current-database')
    await scheduleDesktopDataBackupRestore(archivePath)
    await runPendingDesktopDataBackup('1.2.3')
    expect(readFileSync(join(dataRoot, 'cradle.db'), 'utf8')).toBe('backup-database')

    await rollbackDesktopDataBackupAfterHealthFailure('server readiness failed')
    expect(readFileSync(join(dataRoot, 'cradle.db'), 'utf8')).toBe('current-database')
    expect(getDesktopDataBackupStatus()).toMatchObject({
      phase: 'failed',
      errorMessage: 'server readiness failed',
    })
  })

  it('rejects an archive without a Cradle manifest without touching active data', async () => {
    const { fixture, dataRoot, archivePath } = await createFixture()
    writeFileSync(join(dataRoot, 'cradle.db'), 'keep-current-data')
    const invalidRoot = join(fixture, 'invalid')
    mkdirSync(invalidRoot)
    writeFileSync(join(invalidRoot, 'not-a-backup.txt'), 'invalid')
    await tar.c({ cwd: invalidRoot, file: archivePath, gzip: true }, ['.'])

    await scheduleDesktopDataBackupRestore(archivePath)
    await expect(runPendingDesktopDataBackup('1.2.3')).resolves.toMatchObject({
      restored: false,
      failed: true,
    })
    expect(readFileSync(join(dataRoot, 'cradle.db'), 'utf8')).toBe('keep-current-data')
  })
})
