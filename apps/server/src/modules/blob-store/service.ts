import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type { Blob } from '@cradle/db'
import { blobs } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'

export type BlobRecord = Blob

type BlobStoreDb = ReturnType<typeof db>
export type BlobStoreTx = Parameters<Parameters<BlobStoreDb['transaction']>[0]>[0]
export type BlobStoreWriteDb = BlobStoreDb | BlobStoreTx

export type BlobStoreWriteHandle = Pick<BlobStoreWriteDb, 'select' | 'insert' | 'delete'>

function resolveDataRoot(): string {
  const config = getServerConfig()
  return resolve(config.dataDir ?? dirname(config.dbPath))
}

/** Resolve a data-directory-relative storage path; reject escapes outside the root. */
export function resolveBlobStorePath(storagePath: string): string {
  const dataRoot = resolveDataRoot()
  const fullPath = resolve(dataRoot, storagePath)
  const rel = relative(dataRoot, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError({
      code: 'blob_storage_path_invalid',
      status: 500,
      message: 'Blob storage path is outside the Cradle data directory',
      details: { storagePath },
    })
  }
  return fullPath
}

function blobStoragePath(sha256: string, mediaType: string): string {
  const mediaTypeHash = createHash('sha256').update(mediaType).digest('hex').slice(0, 16)
  return `blobs/${sha256.slice(0, 2)}/${sha256}-${mediaTypeHash}`
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function findBlob(
  d: BlobStoreWriteHandle,
  sha256: string,
  mediaType: string,
): BlobRecord | undefined {
  return d
    .select()
    .from(blobs)
    .where(and(eq(blobs.sha256, sha256), eq(blobs.mediaType, mediaType)))
    .get()
}

/**
 * Store bytes under a representation-addressed path. Identical bytes with the
 * same media type reuse the existing row; the store owns no media-type or size
 * policy.
 *
 * Synchronous on purpose: better-sqlite3 transactions cannot span `await`, and
 * callers must claim the blob row and insert their ref on the same write handle
 * inside one transaction (otherwise GC can delete a freshly-deduped unreferenced
 * row before the ref lands).
 */
export function putBlob(input: {
  bytes: Buffer
  mediaType: string
  d: BlobStoreWriteHandle
}): BlobRecord {
  const sha256 = hashBytes(input.bytes)
  const existing = findBlob(input.d, sha256, input.mediaType)
  if (existing) {
    return existing
  }

  const storagePath = blobStoragePath(sha256, input.mediaType)
  const fullPath = resolveBlobStorePath(storagePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  // Representation-addressed path: a concurrent writer may already have created
  // this file with identical bytes and media type, so omit the exclusive `wx`
  // flag and trust the identity hashes.
  writeFileSync(fullPath, input.bytes)

  try {
    return input.d.insert(blobs).values({
      id: randomUUID(),
      sha256,
      mediaType: input.mediaType,
      byteSize: input.bytes.length,
      storagePath,
      createdAt: currentUnixSeconds(),
    }).returning().get()
  }
  catch (error) {
    // Unique content+media-type race: another writer won; keep their file and return its row.
    const raced = findBlob(input.d, sha256, input.mediaType)
    if (raced) {
      return raced
    }
    rmSync(fullPath, { force: true })
    throw error
  }
}

export function getBlob(id: string): BlobRecord {
  const row = db().select().from(blobs).where(eq(blobs.id, id)).get()
  if (!row) {
    throw new AppError({
      code: 'blob_not_found',
      status: 404,
      message: 'Blob not found',
      details: { blobId: id },
    })
  }
  return row
}

export async function readBlobBytes(id: string): Promise<{
  bytes: Buffer
  mediaType: string
  byteSize: number
}> {
  const blob = getBlob(id)
  return {
    bytes: readFileSync(resolveBlobStorePath(blob.storagePath)),
    mediaType: blob.mediaType,
    byteSize: blob.byteSize,
  }
}
