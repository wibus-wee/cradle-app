import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll } from 'vitest'

process.env.NODE_ENV = 'test'
process.chdir(dirname(fileURLToPath(import.meta.url)))

const testDataDir = mkdtempSync(join(tmpdir(), 'cradle-server-vitest-'))

process.env.CRADLE_DATA_DIR = testDataDir
delete process.env.CRADLE_DB_PATH

type AddressLookup = (hostname: string) => Promise<string[]>
const testGlobal = globalThis as typeof globalThis & {
  __cradleSsrAddressLookupForTests?: AddressLookup | null
}

testGlobal.__cradleSsrAddressLookupForTests = async (hostname) => {
  if (hostname === 'localhost') {
    return ['127.0.0.1']
  }
  return ['93.184.216.34']
}

afterAll(async () => {
  const [{ shutdownInfra }, { destroyWorkspaceFileIndexes }] = await Promise.all([
    import('./src/infra'),
    import('./src/modules/workspace/files'),
  ])
  destroyWorkspaceFileIndexes()
  shutdownInfra()
  rmSync(testDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
})
