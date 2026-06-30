import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { REQUEST_ID_HEADER } from '../src/http/request-id'
import { shutdownInfra } from '../src/infra'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('request id middleware', () => {
  it('adds x-request-id header', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp()
      const res = await app.handle(new Request('http://localhost/health'))
      expect(res.status).toBe(200)
      expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy()
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
})
