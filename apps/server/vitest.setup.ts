import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll } from 'vitest'

process.env.NODE_ENV = 'test'

const testDataDir = mkdtempSync(join(tmpdir(), 'cradle-server-vitest-'))

process.env.CRADLE_DATA_DIR = testDataDir
delete process.env.CRADLE_DB_PATH

afterAll(async () => {
  const [{ shutdownInfra }, { destroyWorkspaceFileIndexes }] = await Promise.all([
    import('./src/infra'),
    import('./src/modules/workspace/files'),
  ])
  destroyWorkspaceFileIndexes()
  shutdownInfra()
  rmSync(testDataDir, { recursive: true, force: true })
})
