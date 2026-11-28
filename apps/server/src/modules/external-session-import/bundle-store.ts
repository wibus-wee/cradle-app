import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'

import { z } from 'zod'

import { getServerConfig } from '../../infra'
import { createSourceFilesRevision } from './source-utils'
import type {
  ExternalSessionBundle,
  ExternalSessionBundleFile,
  ExternalSessionBundleManifest,
  ExternalSessionDescriptor,
} from './types'

export const EXTERNAL_SESSION_IMPORT_PARSER_VERSION = 1

const BundleManifestSchema = z.object({
  version: z.literal(1),
  parserVersion: z.number().int().positive(),
  sourceHostId: z.string().min(1),
  // Validated as a bare string: source apps are added by adapter ownership,
  // and bundle integrity is checked against the descriptor fields below.
  sourceApp: z.string().min(1),
  externalSessionId: z.string().min(1),
  sourceRevision: z.string().min(1),
  capturedAt: z.number().int().nonnegative(),
  files: z.array(z.object({
    sourcePath: z.string().min(1),
    bundlePath: z.string().min(1),
    kind: z.enum(['main', 'subagent']),
    sourceId: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
})

export async function captureExternalSessionBundle(
  descriptor: ExternalSessionDescriptor,
): Promise<ExternalSessionBundle> {
  if (descriptor.sourceFiles.length === 0) {
    throw new Error(`External session ${descriptor.externalSessionId} has no JSONL source files`)
  }
  const storagePath = join(
    'external-session-import',
    descriptor.sourceApp,
    descriptor.candidateId,
    descriptor.sourceRevision,
  )
  const absolutePath = resolveImportStoragePath(storagePath)
  const existing = await readBundleIfPresent(storagePath, absolutePath, descriptor)
  if (existing) {
    return existing
  }

  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`
  await mkdir(join(temporaryPath, 'source'), { recursive: true })
  try {
    const files: ExternalSessionBundleFile[] = []
    for (const [index, source] of descriptor.sourceFiles.entries()) {
      const before = await stat(source.path)
      assertSourceFileUnchanged(source.path, source.size, source.modifiedAtMs, before.size, before.mtimeMs)
      const fileName = `${String(index).padStart(3, '0')}-${source.kind}.jsonl.gz`
      const bundlePath = join('source', fileName)
      const outputPath = join(temporaryPath, bundlePath)
      const hash = createHash('sha256')
      const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        createReadStream(source.path),
        hasher,
        createGzip(),
        createWriteStream(outputPath, { flags: 'wx' }),
      )
      const after = await stat(source.path)
      assertSourceFileUnchanged(source.path, source.size, source.modifiedAtMs, after.size, after.mtimeMs)
      files.push({
        sourcePath: source.path,
        bundlePath,
        kind: source.kind,
        sourceId: source.sourceId,
        size: source.size,
        sha256: hash.digest('hex'),
      })
    }

    const observedRevision = createSourceFilesRevision({
      externalSessionId: descriptor.externalSessionId,
      files: descriptor.sourceFiles,
    })
    if (observedRevision !== descriptor.sourceRevision) {
      throw new Error('External session source changed after preview; scan again before importing')
    }
    const manifest: ExternalSessionBundleManifest = {
      version: 1,
      parserVersion: EXTERNAL_SESSION_IMPORT_PARSER_VERSION,
      sourceHostId: descriptor.sourceHostId,
      sourceApp: descriptor.sourceApp,
      externalSessionId: descriptor.externalSessionId,
      sourceRevision: descriptor.sourceRevision,
      capturedAt: Math.floor(Date.now() / 1000),
      files,
    }
    await writeFile(join(temporaryPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await mkdir(dirname(absolutePath), { recursive: true })
    await rename(temporaryPath, absolutePath)
    return { storagePath, absolutePath, manifest, created: true }
  }
  catch (error) {
    await rm(temporaryPath, { recursive: true, force: true })
    const concurrent = await readBundleIfPresent(storagePath, absolutePath, descriptor)
    if (concurrent) {
      return concurrent
    }
    throw error
  }
}

export function openExternalSessionBundleFile(
  bundle: ExternalSessionBundle,
  file: ExternalSessionBundleFile,
) {
  const path = resolve(bundle.absolutePath, file.bundlePath)
  if (!path.startsWith(`${resolve(bundle.absolutePath)}${sep}`)) {
    throw new Error('External session bundle member escapes its bundle root')
  }
  const hash = createHash('sha256')
  let size = 0
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      const digest = hash.digest('hex')
      if (size !== file.size || digest !== file.sha256) {
        callback(new Error(`External session bundle member failed integrity verification: ${file.bundlePath}`))
        return
      }
      callback()
    },
  })
  return createReadStream(path).pipe(createGunzip()).pipe(verifier)
}

export async function removeExternalSessionBundle(bundle: ExternalSessionBundle): Promise<void> {
  if (!bundle.created) {
    return
  }
  await rm(bundle.absolutePath, { recursive: true, force: true })
}

async function readBundleIfPresent(
  storagePath: string,
  absolutePath: string,
  descriptor: ExternalSessionDescriptor,
): Promise<ExternalSessionBundle | null> {
  let manifestJson: string
  try {
    manifestJson = await readFile(join(absolutePath, 'manifest.json'), 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  const manifest = BundleManifestSchema.parse(JSON.parse(manifestJson)) as ExternalSessionBundleManifest
  if (manifest.sourceHostId !== descriptor.sourceHostId
    || manifest.sourceApp !== descriptor.sourceApp
    || manifest.externalSessionId !== descriptor.externalSessionId
    || manifest.sourceRevision !== descriptor.sourceRevision) {
    throw new Error('External session bundle identity does not match its source descriptor')
  }
  return { storagePath, absolutePath, manifest, created: false }
}

function resolveImportStoragePath(storagePath: string): string {
  const config = getServerConfig()
  const dataRoot = resolve(config.dataDir ?? dirname(config.dbPath))
  const absolutePath = resolve(dataRoot, storagePath)
  if (relative(dataRoot, absolutePath).startsWith('..')) {
    throw new Error('External session bundle path escapes the Cradle data directory')
  }
  return absolutePath
}

function assertSourceFileUnchanged(
  path: string,
  expectedSize: number,
  expectedModifiedAtMs: number,
  actualSize: number,
  actualModifiedAtMs: number,
): void {
  if (actualSize !== expectedSize || actualModifiedAtMs !== expectedModifiedAtMs) {
    throw new Error(`External session source changed after preview: ${path}`)
  }
}
