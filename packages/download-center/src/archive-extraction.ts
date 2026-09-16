import { createWriteStream } from 'node:fs'
import { lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { extract as extractTar, list as listTar } from 'tar'
import type { Entry, ZipFile } from 'yauzl'
import { openPromise as openZipPromise } from 'yauzl'

import type { InstallationErrorFactory } from './versioned-installation'
import { isPathInside } from './versioned-installation'

export type ArchiveFormat = 'zip' | 'tar'

/**
 * Per-entry decision for archive payloads. Directory entries are always
 * permitted; regular files are classified by the owner:
 * - `payload`: extracted and reported to the caller.
 * - `ignore`: permitted but skipped (e.g. npm `package/package.json`).
 * - `reject`: aborts extraction.
 * Anything that is not a directory or regular file (symlinks, devices, …) is
 * always rejected.
 */
export interface ArchivePayloadSpec {
  classify: (normalizedPath: string, payloadPaths: readonly string[]) => 'payload' | 'ignore' | 'reject'
  /** Post-scan completeness check over the collected payload paths. */
  isComplete: (payloadPaths: readonly string[]) => boolean
}

/** Reject absolute paths, `..` segments, and NUL bytes in archive entries. */
export function validateArchiveEntryPath(
  entryPath: string,
  createError: InstallationErrorFactory,
): void {
  const normalized = entryPath.replaceAll('\\', '/')
  if (
    entryPath.includes('\0')
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(entryPath)
    || normalized.split('/').includes('..')
  ) {
    throw createError('archive_invalid', 422, 'The archive contains an unsafe path.')
  }
}

function readNextZipEntry(zipfile: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry): void => {
      cleanup()
      resolve(entry)
    }
    const onEnd = (): void => {
      cleanup()
      resolve(null)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      zipfile.off('entry', onEntry)
      zipfile.off('end', onEnd)
      zipfile.off('error', onError)
    }
    zipfile.on('entry', onEntry)
    zipfile.on('end', onEnd)
    zipfile.on('error', onError)
    zipfile.readEntry()
  })
}

async function extractZipPayload(
  archivePath: string,
  spec: ArchivePayloadSpec,
  destination: string,
  createError: InstallationErrorFactory,
): Promise<string[]> {
  const payloadPaths: string[] = []
  const zipfile = await openZipPromise(archivePath, { lazyEntries: true })
  try {
    for (;;) {
      const entry = await readNextZipEntry(zipfile)
      if (!entry) {
        break
      }
      validateArchiveEntryPath(entry.fileName, createError)
      const normalized = entry.fileName.replaceAll('\\', '/')
      const isDirectory = normalized.endsWith('/')
      const mode = (entry.externalFileAttributes >> 16) & 0xFFFF
      const fileType = mode & 0o170000
      const isSymlink = fileType === 0o120000
      const isRegular = fileType === 0 || fileType === 0o100000
      if (isSymlink || (!isDirectory && !isRegular)) {
        throw createError('archive_invalid', 422, 'The archive contains an unsupported entry.')
      }
      if (isDirectory) {
        continue
      }
      const decision = spec.classify(normalized, payloadPaths)
      if (decision === 'reject') {
        throw createError('archive_invalid', 422, 'The archive contains unexpected contents.')
      }
      if (decision === 'ignore') {
        continue
      }
      payloadPaths.push(normalized)
      const filePath = path.resolve(destination, normalized)
      await mkdir(path.dirname(filePath), { recursive: true })
      const readStream = await zipfile.openReadStreamPromise(entry)
      await pipeline(readStream, createWriteStream(filePath))
    }
  }
  finally {
    zipfile.close()
  }
  if (!spec.isComplete(payloadPaths)) {
    throw createError('archive_invalid', 422, 'The archive is missing expected payload files.')
  }
  return payloadPaths
}

async function extractTarPayload(
  archivePath: string,
  spec: ArchivePayloadSpec,
  destination: string,
  createError: InstallationErrorFactory,
): Promise<string[]> {
  const scan: { error: Error | null, payloadPaths: string[] } = { error: null, payloadPaths: [] }
  await listTar({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      if (scan.error) {
        return
      }
      try {
        const entryPath = entry.path
        validateArchiveEntryPath(entryPath, createError)
        const isDirectory = entry.type === 'Directory'
        if (!isDirectory && entry.type !== 'File' && entry.type !== 'OldFile') {
          throw createError('archive_invalid', 422, 'The archive contains an unsupported entry.')
        }
        if (isDirectory) {
          return
        }
        const decision = spec.classify(entryPath, scan.payloadPaths)
        if (decision === 'reject') {
          throw createError('archive_invalid', 422, 'The archive contains unexpected contents.')
        }
        if (decision === 'payload') {
          scan.payloadPaths.push(entryPath)
        }
      }
      catch (error) {
        scan.error = error instanceof Error
          ? error
          : createError('archive_invalid', 422, 'The archive failed validation.')
      }
    },
  })
  if (scan.error) {
    throw scan.error
  }
  if (!spec.isComplete(scan.payloadPaths)) {
    throw createError('archive_invalid', 422, 'The archive is missing expected payload files.')
  }
  const payloadPaths = new Set(scan.payloadPaths)
  await extractTar({
    file: archivePath,
    cwd: destination,
    strict: true,
    filter: entryPath => payloadPaths.has(entryPath),
  })
  return scan.payloadPaths
}

/**
 * Validate and extract an archive into `destination`, preserving entry paths.
 * Returns the normalized relative paths of the extracted payload entries;
 * callers relocate them into their version layout.
 */
export async function extractArchivePayload(input: {
  archivePath: string
  format: ArchiveFormat
  destination: string
  spec: ArchivePayloadSpec
  createError: InstallationErrorFactory
}): Promise<string[]> {
  await mkdir(input.destination, { recursive: true })
  const payloadPaths = input.format === 'zip'
    ? await extractZipPayload(input.archivePath, input.spec, input.destination, input.createError)
    : await extractTarPayload(input.archivePath, input.spec, input.destination, input.createError)
  const extractedPaths = payloadPaths.map(relative => path.resolve(input.destination, relative))
  for (const extractedPath of extractedPaths) {
    const stats = await lstat(extractedPath)
    if (!stats.isFile() || stats.isSymbolicLink() || !isPathInside(input.destination, extractedPath)) {
      throw input.createError('archive_invalid', 422, 'An extracted payload entry is invalid.')
    }
  }
  return extractedPaths
}
