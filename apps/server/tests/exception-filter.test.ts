import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error'
import { createErrorHandler } from '../src/http/error-mapping'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('app exception filter', () => {
  it('normalizes AppError responses', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = new Elysia()
        .onError(createErrorHandler())
        .get('/boom', () => {
          throw new AppError({ code: 'boom', status: 418, message: 'boom' })
        })

      const res = await app.handle(new Request('http://localhost/boom'))
      expect(res.status).toBe(418)
      const body = await res.json()
      expect(body.code).toBe('boom')
      expect(body.message).toBe('boom')
    }
    finally {
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
