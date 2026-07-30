import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { blobs } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  getBlob,
  putBlob,
  readBlobBytes,
  resolveBlobStorePath,
} from './service'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-blob-store-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function mediaTypeHash(mediaType: string): string {
  return createHash('sha256').update(mediaType).digest('hex').slice(0, 16)
}

describe('blob-store service', () => {
  it('putBlob writes the file at blobs/<sha[0:2]>/<sha> and inserts one row', async () => {
    await withTempDataDir(async () => {
      const bytes = Buffer.from('hello-blob-store')
      const sha = sha256Hex(bytes)
      const record = await putBlob({ bytes, mediaType: 'text/plain', d: db() })

      expect(record.sha256).toBe(sha)
      expect(record.storagePath).toBe(
        `blobs/${sha.slice(0, 2)}/${sha}-${mediaTypeHash('text/plain')}`,
      )
      expect(record.byteSize).toBe(bytes.length)
      expect(existsSync(resolveBlobStorePath(record.storagePath))).toBe(true)
      expect(db().select().from(blobs).all()).toHaveLength(1)
    })
  })

  it('putBlob twice with identical bytes returns the same id and leaves one row and one file', async () => {
    await withTempDataDir(async () => {
      const bytes = Buffer.from('dedup-bytes')
      const first = await putBlob({ bytes, mediaType: 'application/octet-stream', d: db() })
      const second = await putBlob({ bytes, mediaType: 'application/octet-stream', d: db() })

      expect(second.id).toBe(first.id)
      expect(db().select().from(blobs).all()).toHaveLength(1)
      expect(existsSync(resolveBlobStorePath(first.storagePath))).toBe(true)
    })
  })

  it('putBlob with different bytes and the same media type creates two rows', async () => {
    await withTempDataDir(async () => {
      const first = await putBlob({ bytes: Buffer.from('alpha'), mediaType: 'text/plain', d: db() })
      const second = await putBlob({ bytes: Buffer.from('beta'), mediaType: 'text/plain', d: db() })

      expect(second.id).not.toBe(first.id)
      expect(db().select().from(blobs).all()).toHaveLength(2)
    })
  })

  it('putBlob with identical bytes and different media types keeps distinct metadata and files', async () => {
    await withTempDataDir(async () => {
      const bytes = Buffer.from('same-bytes-different-representation')
      const first = await putBlob({ bytes, mediaType: 'text/plain', d: db() })
      const second = await putBlob({ bytes, mediaType: 'application/octet-stream', d: db() })

      expect(second.id).not.toBe(first.id)
      expect(second.storagePath).not.toBe(first.storagePath)
      expect(db().select().from(blobs).all()).toHaveLength(2)
      expect((await readBlobBytes(first.id)).mediaType).toBe('text/plain')
      expect((await readBlobBytes(second.id)).mediaType).toBe('application/octet-stream')
      expect(existsSync(resolveBlobStorePath(first.storagePath))).toBe(true)
      expect(existsSync(resolveBlobStorePath(second.storagePath))).toBe(true)
    })
  })

  it('getBlob on a missing id throws AppError with code blob_not_found, status 404', async () => {
    await withTempDataDir(() => {
      expect(() => getBlob('missing-blob-id')).toThrowError(
        expect.objectContaining({
          code: 'blob_not_found',
          status: 404,
        }),
      )
    })
  })

  it('readBlobBytes round-trips the exact bytes written', async () => {
    await withTempDataDir(async () => {
      const bytes = Buffer.from([0x00, 0xFF, 0x10, 0x20, 0x7F])
      const record = await putBlob({ bytes, mediaType: 'application/octet-stream', d: db() })
      const read = await readBlobBytes(record.id)

      expect(read.mediaType).toBe('application/octet-stream')
      expect(read.byteSize).toBe(bytes.length)
      expect(Buffer.compare(read.bytes, bytes)).toBe(0)
    })
  })

  it('resolveBlobStorePath rejects a storagePath containing ../ with code blob_storage_path_invalid', async () => {
    await withTempDataDir(() => {
      expect(() => resolveBlobStorePath('../outside')).toThrowError(
        expect.objectContaining({
          code: 'blob_storage_path_invalid',
        }),
      )
      expect(() => resolveBlobStorePath('blobs/../../escape')).toThrowError(
        expect.objectContaining({
          code: 'blob_storage_path_invalid',
        }),
      )
    })
  })

  it('getBlob returns the stored metadata row', async () => {
    await withTempDataDir(async () => {
      const record = await putBlob({ bytes: Buffer.from('meta'), mediaType: 'text/plain', d: db() })
      const loaded = getBlob(record.id)
      expect(loaded).toEqual(record)
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toEqual(record)
    })
  })
})
