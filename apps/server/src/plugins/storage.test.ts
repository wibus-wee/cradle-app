/* Verifies persistent server plugin storage ownership and isolation. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { shutdownInfra } from '../infra'
import { createPluginStorage } from './storage'

let dataDir: string | undefined
let previousDataDir: string | undefined

describe('server plugin storage', () => {
  beforeEach(() => {
    previousDataDir = process.env.CRADLE_DATA_DIR
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-plugin-storage-'))
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()
  })

  afterEach(() => {
    shutdownInfra()
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
 else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
    previousDataDir = undefined
  })

  it('persists values by plugin owner and key', async () => {
    const first = createPluginStorage('@cradle/storage-a')
    const second = createPluginStorage('@cradle/storage-b')

    await first.set('shared-key', 'owner-a')
    await second.set('shared-key', 'owner-b')
    await first.set('shared-key', 'owner-a-updated')

    const reloadedFirst = createPluginStorage('@cradle/storage-a')
    expect(await reloadedFirst.get('shared-key')).toBe('owner-a-updated')
    expect(await second.get('shared-key')).toBe('owner-b')

    await reloadedFirst.delete('shared-key')

    expect(await first.get('shared-key')).toBeNull()
    expect(await second.get('shared-key')).toBe('owner-b')
  })
})
