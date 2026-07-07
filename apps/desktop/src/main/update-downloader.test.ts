import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesktopUpdateCandidate } from './update-types'

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/unused'),
  },
}))

vi.mock('electron', () => electronMocks)

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cradle-update-downloader-'))
  tempRoots.push(root)
  return root
}

function createCandidate(sha256: string | null): DesktopUpdateCandidate {
  return {
    info: {
      version: '1.2.3',
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      files: [],
    },
    artifact: {
      url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
      size: null,
      sha256,
      platform: 'darwin',
      arch: 'universal',
    },
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktopUpdateDownloader', () => {
  it('downloads an artifact and verifies its SHA-256 digest', async () => {
    const payload = Buffer.from('zip-payload')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const downloadDir = await createTempRoot()
    const { DesktopUpdateDownloader } = await import('./update-downloader')
    const downloader = new DesktopUpdateDownloader({
      downloadDir,
      fetchFn: async () => new Response(payload, {
        status: 200,
        headers: {
          'content-length': String(payload.byteLength),
        },
      }),
    })
    const progress: number[] = []

    const download = await downloader.download(createCandidate(sha256), (nextProgress) => {
      progress.push(nextProgress.percent)
    })

    await expect(readFile(download.archivePath, 'utf8')).resolves.toBe('zip-payload')
    expect(download.archivePath).toBe(join(downloadDir, 'Cradle-1.2.3-universal.zip'))
    expect(progress.at(-1)).toBe(100)
  })

  it('removes the temporary archive when SHA-256 verification fails', async () => {
    const payload = Buffer.from('bad-payload')
    const downloadDir = await createTempRoot()
    const { DesktopUpdateDownloader } = await import('./update-downloader')
    const downloader = new DesktopUpdateDownloader({
      downloadDir,
      fetchFn: async () => new Response(payload, { status: 200 }),
    })

    await expect(downloader.download(createCandidate('0'.repeat(64)))).rejects.toThrow('SHA-256')
    await expect(pathExists(join(downloadDir, 'Cradle-1.2.3-universal.zip.download'))).resolves.toBe(false)
  })
})
