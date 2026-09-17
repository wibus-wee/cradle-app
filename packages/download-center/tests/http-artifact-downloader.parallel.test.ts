import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DownloadRequest } from '../src'
import { HttpArtifactDownloader } from '../src'

const owner = {
  namespace: 'test',
  resourceType: 'fixture',
  resourceId: 'artifact-v1',
  displayName: 'Fixture artifact',
}

const request = (overrides: Partial<DownloadRequest> = {}): DownloadRequest => ({
  owner,
  fileName: 'fixture.bin',
  sources: [{ id: 'fixture-v1:origin', url: 'https://downloads.example/fixture.bin' }],
  maxBytes: 1024 * 1024,
  ...overrides,
})

const digest = (value: Buffer, algorithm: 'sha256' | 'sha512') => createHash(algorithm).update(value).digest('hex')

/** A fetch that honors `Range` + `If-Range` like a real CDN would. */
const rangeAwareFetch = (body: Buffer, options: { etag?: string, ranged?: boolean } = {}) => {
  const etag = options.etag ?? '"v1"'
  const ranged = options.ranged ?? true
  return vi.fn<typeof fetch>().mockImplementation((input, init) => {
    void input
    const headers = new Headers(init?.headers)
    const range = headers.get('range')
    const ifRange = headers.get('if-range')
    if (!ranged || (ifRange !== null && ifRange !== etag)) {
      return Promise.resolve(new Response(new Uint8Array(body), {
        status: 200,
        headers: { 'content-length': String(body.length), etag },
      }))
    }
    if (range !== null) {
      const match = range.match(/^bytes=(\d+)-(\d*)$/)
      if (match) {
        const start = Number(match[1])
        const end = match[2] === '' ? body.length - 1 : Number(match[2])
        if (start >= body.length || end >= body.length || end < start) {
          return Promise.resolve(new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${body.length}` },
          }))
        }
        const slice = body.subarray(start, end + 1)
        return Promise.resolve(new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            'content-length': String(slice.length),
            'content-range': `bytes ${start}-${end}/${body.length}`,
            'content-encoding': 'identity',
            etag,
          },
        }))
      }
    }
    return Promise.resolve(new Response(new Uint8Array(body), {
      status: 200,
      headers: { 'content-length': String(body.length), etag },
    }))
  })
}

const rangesSent = (fetchMock: ReturnType<typeof rangeAwareFetch>): string[] =>
  fetchMock.mock.calls.map(call => new Headers(call[1]?.headers).get('range') ?? '<none>')

describe('httpArtifactDownloader parallel connections', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'download-center-parallel-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('splits a range-capable download into concurrent chunks and assembles them', async () => {
    const body = Buffer.from('0123456789abcdef')
    const fetchMock = rangeAwareFetch(body)
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      parallelConnections: 4,
      parallelMinBytes: 1,
    })

    const result = await downloader.download({ taskId: 'parallel', request: request() })

    expect(result.artifact.bytes).toBe(body.length)
    expect(await readFile(result.artifact.filePath)).toEqual(body)
    // One whole-file probe, then 4 chunk requests — 4 bytes each.
    expect(rangesSent(fetchMock)).toEqual(['bytes=0-', 'bytes=0-3', 'bytes=4-7', 'bytes=8-11', 'bytes=12-15'])
    // Chunks carry the probe etag as If-Range.
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(new Headers(call[1]?.headers).get('if-range')).toBe('"v1"')
    }
    expect(existsSync(path.join(rootDir, 'partial', 'parallel.chunks'))).toBe(false)
    expect(existsSync(path.join(rootDir, 'partial', 'parallel.part'))).toBe(false)
  })

  it('streams a 200 whole-body when the server ignores ranges', async () => {
    const body = Buffer.from('0123456789abcdef')
    const fetchMock = rangeAwareFetch(body, { ranged: false })
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      parallelConnections: 4,
      parallelMinBytes: 1,
    })

    const result = await downloader.download({ taskId: 'no-ranges', request: request() })

    expect(await readFile(result.artifact.filePath)).toEqual(body)
    expect(rangesSent(fetchMock)).toEqual(['bytes=0-'])
  })

  it('consumes a small-file 206 probe body without a second request', async () => {
    const body = Buffer.from('tiny')
    const fetchMock = rangeAwareFetch(body)
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      parallelConnections: 4,
      parallelMinBytes: 1024,
    })

    const result = await downloader.download({ taskId: 'small', request: request() })

    expect(await readFile(result.artifact.filePath)).toEqual(body)
    expect(rangesSent(fetchMock)).toEqual(['bytes=0-'])
  })

  it('resumes a persisted chunk plan from per-chunk file sizes', async () => {
    const body = Buffer.from('0123456789abcdef')
    const taskId = 'resume-chunks'
    const chunkDir = path.join(rootDir, 'partial', `${taskId}.chunks`)
    await mkdir(chunkDir, { recursive: true })
    await writeFile(path.join(chunkDir, 'state.json'), JSON.stringify({
      sourceId: 'fixture-v1:origin',
      etag: '"v1"',
      totalBytes: body.length,
      chunkSize: 4,
      connections: 4,
    }))
    // Chunk 0 finished, chunk 1 stopped mid-flight, chunks 2/3 never started.
    await writeFile(path.join(chunkDir, '0.part'), body.subarray(0, 4))
    await writeFile(path.join(chunkDir, '1.part'), body.subarray(4, 6))

    const fetchMock = rangeAwareFetch(body)
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      parallelConnections: 4,
      parallelMinBytes: 1,
    })

    const result = await downloader.download({ taskId, request: request() })

    expect(await readFile(result.artifact.filePath)).toEqual(body)
    // No probe: the persisted plan goes straight to the missing ranges —
    // chunk 1 resumes at its on-disk offset, chunks 2/3 fetch in full.
    expect(rangesSent(fetchMock)).toEqual(['bytes=6-7', 'bytes=8-11', 'bytes=12-15'])
  })

  it('restarts once when a chunk sees the recorded etag go stale', async () => {
    const body = Buffer.from('0123456789abcdef')
    let generation = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const headers = new Headers(init?.headers)
      const range = headers.get('range')
      const ifRange = headers.get('if-range')
      void input
      if (range === 'bytes=0-' && ifRange === null) {
        generation += 1
        const etag = `"v${generation}"`
        return Promise.resolve(new Response(new Uint8Array(body), {
          status: 206,
          headers: {
            'content-length': String(body.length),
            'content-range': `bytes 0-${body.length - 1}/${body.length}`,
            etag,
          },
        }))
      }
      // First generation's etag is stale by the time chunks fetch: answer 200.
      if (ifRange === '"v1"') {
        return Promise.resolve(new Response(new Uint8Array(body), { status: 200, headers: { etag: '"v2"' } }))
      }
      const match = range?.match(/^bytes=(\d+)-(\d+)$/)
      if (match && ifRange === '"v2"') {
        const start = Number(match[1])
        const end = Number(match[2])
        const slice = body.subarray(start, end + 1)
        return Promise.resolve(new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            'content-length': String(slice.length),
            'content-range': `bytes ${start}-${end}/${body.length}`,
            'etag': '"v2"',
          },
        }))
      }
      return Promise.resolve(new Response(null, { status: 500 }))
    })
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      parallelConnections: 4,
      parallelMinBytes: 1,
    })

    const result = await downloader.download({ taskId: 'stale-etag', request: request() })

    expect(await readFile(result.artifact.filePath)).toEqual(body)
    // Two probes: v1 plan went stale on the first chunk, v2 plan succeeded.
    expect(rangesSent(fetchMock).filter(range => range === 'bytes=0-')).toHaveLength(2)
  })

  it('still verifies checksum and size after chunked assembly', async () => {
    const body = Buffer.from('0123456789abcdef')
    const fetchMock = rangeAwareFetch(body)
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      parallelConnections: 4,
      parallelMinBytes: 1,
    })

    const result = await downloader.download({
      taskId: 'verified',
      request: request({
        integrity: {
          expectedBytes: body.length,
          checksum: { algorithm: 'sha256', value: digest(body, 'sha256') },
        },
      }),
    })

    expect(result.artifact.checksum.matched).toBe(true)
  })
})
