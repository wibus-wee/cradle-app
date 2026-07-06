import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { app } from 'electron'

import type { DesktopUpdateCandidate, DesktopUpdateDownload } from './update-types'

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type DesktopUpdateDownloadProgress = {
  percent: number
  transferredBytes: number
  totalBytes: number | null
}

export type DesktopUpdateDownloaderOptions = {
  downloadDir?: string
  fetchFn?: FetchFn
}

export class DesktopUpdateDownloader {
  private readonly downloadDir: string
  private readonly fetchFn: FetchFn

  constructor(options: DesktopUpdateDownloaderOptions = {}) {
    this.downloadDir = options.downloadDir ?? join(app.getPath('userData'), 'updates', 'downloads')
    this.fetchFn = options.fetchFn ?? fetch
  }

  async download(
    candidate: DesktopUpdateCandidate,
    onProgress?: (progress: DesktopUpdateDownloadProgress) => void,
  ): Promise<DesktopUpdateDownload> {
    await mkdir(this.downloadDir, { recursive: true })

    const archiveName = readArchiveName(candidate.artifact.url, candidate.info.version)
    const archivePath = join(this.downloadDir, archiveName)
    const temporaryPath = `${archivePath}.download`
    const response = await this.fetchFn(candidate.artifact.url, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Update download failed with HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error('Update download response did not include a body')
    }

    const expectedBytes = candidate.artifact.size ?? readContentLength(response)
    const digest = createHash('sha256')
    const writer = createWriteStream(temporaryPath)
    const writerError = once(writer, 'error').then(([error]) => {
      throw error
    })
    let transferredBytes = 0

    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const chunk = Buffer.from(value)
        transferredBytes += chunk.byteLength
        digest.update(chunk)

        if (!writer.write(chunk)) {
          await Promise.race([once(writer, 'drain'), writerError])
        }

        onProgress?.({
          percent: readProgressPercent(transferredBytes, expectedBytes),
          transferredBytes,
          totalBytes: expectedBytes,
        })
      }
    }
    catch (error) {
      writer.destroy()
      await rm(temporaryPath, { force: true })
      throw error
    }
    finally {
      reader.releaseLock()
    }

    writer.end()
    await Promise.race([once(writer, 'finish'), writerError])

    const actualSha256 = digest.digest('hex')
    if (candidate.artifact.sha256 && actualSha256.toLowerCase() !== candidate.artifact.sha256.toLowerCase()) {
      await rm(temporaryPath, { force: true })
      throw new Error('Update archive SHA-256 verification failed')
    }

    await rename(temporaryPath, archivePath)
    onProgress?.({
      percent: 100,
      transferredBytes,
      totalBytes: expectedBytes,
    })

    return {
      artifact: candidate.artifact,
      archivePath,
    }
  }
}

function readArchiveName(url: string, version: string): string {
  const pathName = new URL(url).pathname
  const fileName = basename(pathName)
  if (fileName) {
    return fileName
  }
  return `Cradle-${version}-mac.zip`
}

function readContentLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function readProgressPercent(transferredBytes: number, totalBytes: number | null): number {
  if (!totalBytes || totalBytes <= 0) {
    return 0
  }

  return Math.max(0, Math.min(100, (transferredBytes / totalBytes) * 100))
}
