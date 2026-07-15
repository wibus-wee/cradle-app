import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DownloadProgress, DownloadRequest, DownloadTimerHooks } from '../src'
import {
  DownloadError,
  HttpArtifactDownloader,
} from '../src'

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
  maxBytes: 1024,
  ...overrides,
})

const streamResponse = (
  chunks: readonly Uint8Array[],
  init: ResponseInit = {},
): Response => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) {
      controller.enqueue(chunk)
    }
    controller.close()
  },
}), init)

const failingBodyResponse = (prefix: Uint8Array): Response => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(prefix)
    controller.error(new Error('secret upstream failure'))
  },
}))

const digest = (value: string, algorithm: 'sha256' | 'sha512') => createHash(algorithm).update(value).digest('hex')

describe('httpArtifactDownloader', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'download-center-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(rootDir, { recursive: true, force: true })
  })

  it.each([
    { label: 'known length', headers: { 'content-length': '6' } },
    { label: 'unknown length', headers: {} },
  ])('downloads a 200 response with $label and promotes it atomically', async ({ headers }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(streamResponse([
      new TextEncoder().encode('abc'),
      new TextEncoder().encode('def'),
    ], { status: 200, headers }))
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })

    const result = await downloader.download({ taskId: 'task-200', request: request() })

    expect(result.artifact.bytes).toBe(6)
    expect(result.artifact.checksum).toEqual({
      algorithm: 'sha256',
      expected: null,
      actual: digest('abcdef', 'sha256'),
      matched: null,
    })
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('abcdef')
    expect(existsSync(path.join(rootDir, 'partial', 'task-200.part'))).toBe(false)
  })

  it('waits for the destination writer to close before promotion resolves', async () => {
    let writerClosed = false
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('closed')])),
      writeStreamFactory: (filePath, flags) => {
        const writer = createWriteStream(filePath, { flags })
        writer.once('close', () => {
          writerClosed = true
        })
        return writer
      },
    })
    const result = await downloader.download({ taskId: 'writer-close-success', request: request() })
    expect(writerClosed).toBe(true)
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('closed')
  })

  it('uses a backpressure-aware pipeline for multi-chunk bodies', async () => {
    let writes = 0
    let activeWrites = 0
    let maximumActiveWrites = 0
    const writer = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        writes += 1
        activeWrites += 1
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
        queueMicrotask(() => {
          activeWrites -= 1
          callback()
        })
      },
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(streamResponse([
      Uint8Array.of(1),
      Uint8Array.of(2),
      Uint8Array.of(3),
    ]))
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: fetchMock,
      writeStreamFactory: () => writer,
    })

    await expect(downloader.download({ taskId: 'backpressure', request: request() })).rejects.toMatchObject({ code: 'filesystem_error' })
    expect(writes).toBe(3)
    expect(maximumActiveWrites).toBe(1)
  })

  it('follows at most five HTTPS redirects and rejects an unsafe hop', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://mirror.example/file' } }))
      .mockResolvedValueOnce(streamResponse([new TextEncoder().encode('ok')]))
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })
    await downloader.download({ taskId: 'redirect', request: request() })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const unsafe = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://mirror.example/file' } })),
    })
    await expect(unsafe.download({ taskId: 'unsafe', request: request() })).rejects.toMatchObject({ code: 'redirect_error' })

    const excessive = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://mirror.example/file' } })),
    })
    await expect(excessive.download({ taskId: 'excessive', request: request() })).rejects.toMatchObject({ code: 'redirect_error' })
  })

  it('distinguishes header and body inactivity timeouts from caller cancellation', async () => {
    vi.useFakeTimers()
    const timers: DownloadTimerHooks = {
      now: Date.now,
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
    let markHeaderStarted: (() => void) | undefined
    const headerStarted = new Promise<void>((resolve) => { markHeaderStarted = resolve })
    const pendingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      markHeaderStarted?.()
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const headerDownloader = new HttpArtifactDownloader({ rootDir, fetch: pendingFetch, timers, inactivityTimeoutMs: 100 })
    const headerResult = headerDownloader.download({ taskId: 'header-timeout', request: request() })
    const headerExpectation = expect(headerResult).rejects.toMatchObject({ code: 'timeout', retryable: true })
    await headerStarted
    await vi.advanceTimersByTimeAsync(100)
    await headerExpectation

    let markBodyStarted: (() => void) | undefined
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve })
    const stalledBody = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1))
      },
    })))
    const bodyDownloader = new HttpArtifactDownloader({
      rootDir,
      fetch: stalledBody,
      timers,
      inactivityTimeoutMs: 100,
      writeStreamFactory: (filePath, flags) => {
        markBodyStarted?.()
        return createWriteStream(filePath, { flags })
      },
    })
    const bodyResult = bodyDownloader.download({ taskId: 'body-timeout', request: request() })
    const bodyExpectation = expect(bodyResult).rejects.toMatchObject({ code: 'timeout' })
    await bodyStarted
    await vi.advanceTimersByTimeAsync(100)
    await bodyExpectation

    const controller = new AbortController()
    let markCancelStarted: (() => void) | undefined
    const cancelStarted = new Promise<void>((resolve) => { markCancelStarted = resolve })
    const cancelFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      markCancelStarted?.()
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const cancelProgress: DownloadProgress[] = []
    const cancelDownloader = new HttpArtifactDownloader({
      rootDir,
      fetch: cancelFetch,
      timers,
      inactivityTimeoutMs: 100,
      onProgress: progress => cancelProgress.push(progress),
    })
    const cancelResult = cancelDownloader.download({ taskId: 'cancel', request: request(), signal: controller.signal })
    const cancelExpectation = expect(cancelResult).rejects.toMatchObject({ code: 'cancelled', retryable: false })
    await cancelStarted
    controller.abort()
    await cancelExpectation
    expect(cancelProgress.at(-1)?.status).toBe('cancelled')
  })

  it('classifies network, 5xx, and 4xx failures without exposing source details', async () => {
    const cases: Array<{ response: Response | Error, code: string, retryable: boolean }> = [
      { response: new Error('https://secret.example?token=value'), code: 'network_error', retryable: true },
      { response: new Response(null, { status: 503 }), code: 'http_server_error', retryable: true },
      { response: new Response(null, { status: 404 }), code: 'http_client_error', retryable: false },
    ]
    for (const [index, testCase] of cases.entries()) {
      const fetchMock = vi.fn<typeof fetch>()
      if (testCase.response instanceof Error) {
        fetchMock.mockRejectedValue(testCase.response)
      }
      else {
        fetchMock.mockResolvedValue(testCase.response)
      }
      const result = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })
        .download({ taskId: `failure-${index}`, request: request() })
      const error = await result.then<DownloadError, DownloadError>(
        () => { throw new Error('Expected the download to fail.') },
        value => value as DownloadError,
      )
      expect(error).toMatchObject({ code: testCase.code, retryable: testCase.retryable })
      expect(error.message).not.toContain('secret.example')
      expect(error.message).not.toContain('token')
    }
  })

  it('enforces Content-Length hints and actual streamed maxBytes', async () => {
    const hinted = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([], { headers: { 'content-length': '100' } })),
    })
    await expect(hinted.download({ taskId: 'hinted-limit', request: request({ maxBytes: 10 }) })).rejects.toMatchObject({ code: 'byte_limit_exceeded' })

    const streamed = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('12345678901')])),
    })
    await expect(streamed.download({ taskId: 'streamed-limit', request: request({ maxBytes: 10 }) })).rejects.toMatchObject({ code: 'byte_limit_exceeded' })
  })

  it('checks expected size and SHA-256/SHA-512 over the completed file', async () => {
    const sha256Downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('verified')])),
    })
    const sha256Result = await sha256Downloader.download({
      taskId: 'sha256',
      request: request({ integrity: { expectedBytes: 8, checksum: { algorithm: 'sha256', value: digest('verified', 'sha256') } } }),
    })
    expect(sha256Result.artifact.checksum.matched).toBe(true)

    const sha512Downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('verified')])),
    })
    const sha512Result = await sha512Downloader.download({
      taskId: 'sha512',
      request: request({ integrity: { checksum: { algorithm: 'sha512', value: digest('verified', 'sha512').toUpperCase() } } }),
    })
    expect(sha512Result.artifact.checksum).toMatchObject({ algorithm: 'sha512', matched: true })

    const sizeMismatch = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('short')])),
    })
    await expect(sizeMismatch.download({
      taskId: 'size-mismatch',
      request: request({ integrity: { expectedBytes: 6 } }),
    })).rejects.toMatchObject({ code: 'size_mismatch' })

    const checksumMismatch = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('wrong')])),
    })
    await expect(checksumMismatch.download({
      taskId: 'checksum-mismatch',
      request: request({ integrity: { checksum: { algorithm: 'sha256', value: digest('right', 'sha256') } } }),
    })).rejects.toMatchObject({ code: 'checksum_mismatch' })
  })

  it('returns only strong ETags for host persistence', async () => {
    const strong = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([Uint8Array.of(1)], { headers: { etag: '"v1"' } })),
    })
    await expect(strong.download({ taskId: 'strong', request: request() })).resolves.toMatchObject({ etag: '"v1"' })

    const weak = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([Uint8Array.of(1)], { headers: { etag: 'W/"v1"' } })),
    })
    await expect(weak.download({ taskId: 'weak', request: request() })).resolves.toMatchObject({ etag: null })
  })

  it('returns host-internal resume context and resumes an interrupted strong-ETag transfer', async () => {
    let interruptBody: (() => void) | undefined
    const interruptedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('abc'))
        interruptBody = () => controller.error(new Error('upstream interrupted'))
      },
    })
    const firstDownloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(interruptedBody, {
        headers: { 'content-length': '6', 'etag': '"resume-v1"' },
      })),
      writeStreamFactory: (filePath, flags) => {
        const file = createWriteStream(filePath, { flags })
        return new Writable({
          write(chunk, encoding, callback) {
            file.write(chunk, encoding, (error) => {
              interruptBody?.()
              callback(error)
            })
          },
          final(callback) {
            file.end(callback)
          },
          destroy(error, callback) {
            file.destroy()
            callback(error)
          },
        })
      },
    })
    const failure = await firstDownloader.download({ taskId: 'resume-context', request: request() })
      .then<DownloadError, DownloadError>(
        () => { throw new Error('Expected the first transfer to fail.') },
        error => error as DownloadError,
      )
    expect(failure.toView()).not.toHaveProperty('resumeContext')
    expect(failure.resumeContext).toEqual({
      sourceId: 'fixture-v1:origin',
      etag: '"resume-v1"',
      transferredBytes: 3,
      totalBytes: 6,
    })

    const resumeFetch = vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('def')], {
      status: 206,
      headers: { 'content-range': 'bytes 3-5/6', 'etag': '"resume-v1"' },
    }))
    const secondDownloader = new HttpArtifactDownloader({ rootDir, fetch: resumeFetch })
    const result = await secondDownloader.download({
      taskId: 'resume-context',
      request: request(),
      prior: {
        sourceId: failure.resumeContext?.sourceId ?? '',
        etag: failure.resumeContext?.etag ?? null,
      },
    })
    expect(new Headers(resumeFetch.mock.calls[0]?.[1]?.headers).get('range')).toBe('bytes=3-')
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('abcdef')
  })

  it('appends a valid 206 response using Range, If-Range, and identity encoding', async () => {
    await seedPartial(rootDir, 'resume', 'abc')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('def')], {
      status: 206,
      headers: { 'content-range': 'bytes 3-5/6', 'etag': '"v1"', 'content-encoding': 'identity' },
    }))
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })

    const result = await downloader.download({
      taskId: 'resume',
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('range')).toBe('bytes=3-')
    expect(headers.get('if-range')).toBe('"v1"')
    expect(headers.get('accept-encoding')).toBe('identity')
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('abcdef')
  })

  it('starts at a matching fallback source and safely resumes its partial file', async () => {
    await seedPartial(rootDir, 'resume-fallback', 'abc')
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url, init) => {
      expect(String(url)).toBe('https://mirror.example/file')
      expect(new Headers(init?.headers).get('range')).toBe('bytes=3-')
      return Promise.resolve(streamResponse([new TextEncoder().encode('def')], {
        status: 206,
        headers: { 'content-range': 'bytes 3-5/6', 'etag': '"mirror-v1"' },
      }))
    })
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })
    const result = await downloader.download({
      taskId: 'resume-fallback',
      request: request({
        sources: [
          { id: 'fixture-v1:origin', url: 'https://origin.example/file' },
          { id: 'fixture-v1:mirror', url: 'https://mirror.example/file' },
        ],
      }),
      prior: { sourceId: 'fixture-v1:mirror', etag: '"mirror-v1"' },
    })
    expect(result.sourceId).toBe('fixture-v1:mirror')
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('abcdef')
  })

  it('clears a partial file when prior sourceId is not in the request', async () => {
    await seedPartial(rootDir, 'changed-source', 'stale')
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      expect(new Headers(init?.headers).has('range')).toBe(false)
      expect(new Headers(init?.headers).has('if-range')).toBe(false)
      return Promise.resolve(streamResponse([new TextEncoder().encode('fresh')]))
    })
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })
    const result = await downloader.download({
      taskId: 'changed-source',
      request: request(),
      prior: { sourceId: 'fixture-v0:retired', etag: '"old"' },
    })
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('fresh')
  })

  it('truncates when a server ignores Range with 200', async () => {
    await seedPartial(rootDir, 'range-ignored', 'old')
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('fresh')], { headers: { etag: '"v2"' } })),
    })
    const result = await downloader.download({
      taskId: 'range-ignored',
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('fresh')
    expect(result.etag).toBe('"v2"')
  })

  it('verifies a complete 416 partial and restarts a mismatched 416 once', async () => {
    await seedPartial(rootDir, 'complete-416', 'done')
    const complete = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 416, headers: { 'content-range': 'bytes */4' } })),
    })
    const completeResult = await complete.download({
      taskId: 'complete-416',
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })
    expect(await readFile(completeResult.artifact.filePath, 'utf8')).toBe('done')

    await seedPartial(rootDir, 'mismatch-416', 'old')
    const mismatchFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 416, headers: { 'content-range': 'bytes */9' } }))
      .mockResolvedValueOnce(streamResponse([new TextEncoder().encode('fresh')]))
    const mismatch = new HttpArtifactDownloader({ rootDir, fetch: mismatchFetch })
    const mismatchResult = await mismatch.download({
      taskId: 'mismatch-416',
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })
    expect(await readFile(mismatchResult.artifact.filePath, 'utf8')).toBe('fresh')
    expect(new Headers(mismatchFetch.mock.calls[1]?.[1]?.headers).has('range')).toBe(false)
  })

  it.each([
    {
      label: 'invalid range',
      headers: { 'content-range': 'bytes 2-4/5', 'etag': '"v1"' },
    },
    {
      label: 'changed validator',
      headers: { 'content-range': 'bytes 3-5/6', 'etag': '"v2"' },
    },
    {
      label: 'encoded partial',
      headers: { 'content-range': 'bytes 3-5/6', 'etag': '"v1"', 'content-encoding': 'gzip' },
    },
    {
      label: 'weak validator',
      headers: { 'content-range': 'bytes 3-5/6', 'etag': 'W/"v1"' },
    },
  ])('never appends an $label response', async ({ headers }, index) => {
    const taskId = `unsafe-resume-${index}`
    await seedPartial(rootDir, taskId, 'old')
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(streamResponse([new TextEncoder().encode('bad')], { status: 206, headers }))
      .mockResolvedValueOnce(streamResponse([new TextEncoder().encode('fresh')]))
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })
    const result = await downloader.download({
      taskId,
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('fresh')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never promotes a partial response whose declared range does not match its body', async () => {
    await seedPartial(rootDir, 'truncated-range', 'abc')
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('de')], {
        status: 206,
        headers: { 'content-range': 'bytes 3-5/6', 'etag': '"v1"' },
      })),
    })

    await expect(downloader.download({
      taskId: 'truncated-range',
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: false })
    expect(existsSync(path.join(rootDir, 'artifacts', 'truncated-range', 'fixture.bin'))).toBe(false)
  })

  it('never promotes a short 200 response with a Content-Length', async () => {
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('ab')], {
        headers: { 'content-length': '3' },
      })),
    })

    await expect(downloader.download({
      taskId: 'short-200',
      request: request(),
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: false })
    expect(existsSync(path.join(rootDir, 'artifacts', 'short-200', 'fixture.bin'))).toBe(false)
  })

  it('rejects a 206 response with inconsistent Content-Range and Content-Length before appending', async () => {
    await seedPartial(rootDir, 'inconsistent-range', 'abc')
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('de')], {
        status: 206,
        headers: {
          'content-length': '2',
          'content-range': 'bytes 3-5/6',
          'etag': '"v1"',
        },
      })),
    })

    await expect(downloader.download({
      taskId: 'inconsistent-range',
      request: request(),
      prior: { sourceId: 'fixture-v1:origin', etag: '"v1"' },
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: false })
    expect(await readFile(path.join(rootDir, 'partial', 'inconsistent-range.part'), 'utf8')).toBe('abc')
  })

  it('clears partial bytes and validators before switching fallback source', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(failingBodyResponse(new TextEncoder().encode('first-source')))
      .mockImplementationOnce((_url, init) => {
        const headers = new Headers(init?.headers)
        expect(headers.has('range')).toBe(false)
        expect(headers.has('if-range')).toBe(false)
        return Promise.resolve(streamResponse([new TextEncoder().encode('fallback')], { headers: { etag: '"fallback"' } }))
      })
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: fetchMock })
    const result = await downloader.download({
      taskId: 'fallback',
      request: request({
        sources: [
          { id: 'fixture-v1:origin', url: 'https://origin.example/file' },
          { id: 'fixture-v1:mirror', url: 'https://mirror.example/file' },
        ],
      }),
    })
    expect(result.sourceId).toBe('fixture-v1:mirror')
    expect(await readFile(result.artifact.filePath, 'utf8')).toBe('fallback')
  })

  it('maps writer failures and never promotes the partial file', async () => {
    const writerError = Object.assign(new Error('disk failure'), { code: 'EIO' })
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([new TextEncoder().encode('data')])),
      writeStreamFactory: () => new Writable({
        write(_chunk, _encoding, callback) {
          callback(writerError)
        },
      }),
    })
    await expect(downloader.download({ taskId: 'writer-error', request: request() })).rejects.toMatchObject({ code: 'filesystem_error' })
    expect(existsSync(path.join(rootDir, 'artifacts', 'writer-error', 'fixture.bin'))).toBe(false)
  })

  it('maps a generic writer failure to a task-safe filesystem error', async () => {
    const progress: DownloadProgress[] = []
    let writerClosed = false
    const failingWriter = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('private storage path'))
      },
      destroy(_error, callback) {
        queueMicrotask(callback)
      },
    })
    failingWriter.once('close', () => {
      writerClosed = true
    })
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse(
        [new TextEncoder().encode('data')],
        { headers: { 'content-length': '4', 'etag': '"writer-v1"' } },
      )),
      writeStreamFactory: () => failingWriter,
      onProgress: event => progress.push(event),
    })
    const failure = await downloader.download({ taskId: 'generic-writer-error', request: request() })
      .then<DownloadError, DownloadError>(
        () => { throw new Error('Expected the writer to fail.') },
        error => error as DownloadError,
      )
    expect(failure).toMatchObject({ code: 'filesystem_error', retryable: false })
    expect(writerClosed).toBe(true)
    expect(failure.message).not.toContain('private storage path')
    expect(failure.resumeContext).toEqual({
      sourceId: 'fixture-v1:origin',
      etag: '"writer-v1"',
      transferredBytes: 0,
      totalBytes: 4,
    })
    expect(progress.at(-1)).toMatchObject({ status: 'failed', transferredBytes: 0, totalBytes: 4 })
  })

  it('retains exact bytes and total in integrity-failure terminal progress', async () => {
    const progress: DownloadProgress[] = []
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse(
        [new TextEncoder().encode('short')],
        { headers: { 'content-length': '5', 'etag': '"size-v1"' } },
      )),
      onProgress: event => progress.push(event),
    })
    const failure = await downloader.download({
      taskId: 'terminal-size',
      request: request({ integrity: { expectedBytes: 6 } }),
    }).then<DownloadError, DownloadError>(
      () => { throw new Error('Expected size verification to fail.') },
      error => error as DownloadError,
    )
    expect(failure.resumeContext).toEqual({
      sourceId: 'fixture-v1:origin',
      etag: '"size-v1"',
      transferredBytes: 5,
      totalBytes: 5,
    })
    expect(progress.at(-1)).toMatchObject({ status: 'failed', transferredBytes: 5, totalBytes: 5 })
  })

  it('normalizes malformed redirects and setup filesystem failures', async () => {
    const malformed = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: 'https://[' },
      })),
    })
    await expect(malformed.download({ taskId: 'malformed-redirect', request: request() })).rejects.toMatchObject({
      code: 'redirect_error',
      retryable: false,
    })

    const invalidRoot = path.join(rootDir, 'not-a-directory')
    await writeFile(invalidRoot, 'file')
    const progress: DownloadProgress[] = []
    const filesystemFailure = new HttpArtifactDownloader({
      rootDir: invalidRoot,
      fetch: vi.fn<typeof fetch>(),
      onProgress: event => progress.push(event),
    })
    const error = await filesystemFailure.download({ taskId: 'setup-failure', request: request() })
      .then<DownloadError, DownloadError>(
        () => { throw new Error('Expected setup to fail.') },
        value => value as DownloadError,
      )
    expect(error).toMatchObject({ code: 'filesystem_error', retryable: false })
    expect(error.message).not.toContain(invalidRoot)
    expect(progress.map(event => event.status)).toEqual(['downloading', 'failed'])
  })

  it('flushes initial, transition, and terminal progress synchronously with final bytes', async () => {
    vi.useFakeTimers()
    const progress: DownloadProgress[] = []
    const timers: DownloadTimerHooks = {
      now: Date.now,
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse([
        new TextEncoder().encode('a'),
        new TextEncoder().encode('b'),
        new TextEncoder().encode('c'),
      ])),
      timers,
      onProgress: event => progress.push(event),
    })
    await downloader.download({ taskId: 'progress', request: request() })
    expect(progress.map(event => event.status)).toEqual(['downloading', 'verifying', 'completed'])
    expect(progress.at(-1)).toMatchObject({ transferredBytes: 3, totalBytes: 3, error: null })

    const failedProgress: DownloadProgress[] = []
    const failed = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
      timers,
      onProgress: event => failedProgress.push(event),
    })
    await expect(failed.download({ taskId: 'failed-progress', request: request() })).rejects.toBeInstanceOf(DownloadError)
    expect(failedProgress.map(event => event.status)).toEqual(['downloading', 'failed'])
    expect(failedProgress.at(-1)?.error?.code).toBe('http_client_error')
  })

  it('publishes pending byte progress at most once per 200ms with an injected clock', async () => {
    let now = 0
    let nextTimerId = 0
    const pendingTimers = new Map<number, { due: number, callback: () => void }>()
    const timers: DownloadTimerHooks = {
      now: () => now,
      setTimeout: (callback, delayMs) => {
        nextTimerId += 1
        pendingTimers.set(nextTimerId, { due: now + delayMs, callback })
        return nextTimerId
      },
      clearTimeout: (handle) => {
        pendingTimers.delete(handle as number)
      },
    }
    const advance = async (duration: number): Promise<void> => {
      now += duration
      for (const [timerId, timer] of [...pendingTimers.entries()].sort((left, right) => left[1].due - right[1].due)) {
        if (timer.due <= now) {
          pendingTimers.delete(timerId)
          timer.callback()
        }
      }
      await Promise.resolve()
    }
    let releaseSecondChunk: (() => void) | undefined
    const secondChunkReleased = new Promise<void>((resolve) => { releaseSecondChunk = resolve })
    let markSecondPull: (() => void) | undefined
    const secondPull = new Promise<void>((resolve) => { markSecondPull = resolve })
    let finishBody: (() => void) | undefined
    const bodyFinished = new Promise<void>((resolve) => { finishBody = resolve })
    let markThirdPull: (() => void) | undefined
    const thirdPull = new Promise<void>((resolve) => { markThirdPull = resolve })
    let pullCount = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pullCount += 1
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode('a'))
          return
        }
        if (pullCount === 2) {
          markSecondPull?.()
          await secondChunkReleased
          controller.enqueue(new TextEncoder().encode('b'))
          return
        }
        markThirdPull?.()
        await bodyFinished
        controller.close()
      },
    })
    const emitted: Array<{ at: number, progress: DownloadProgress }> = []
    const downloader = new HttpArtifactDownloader({
      rootDir,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'content-length': '2' } })),
      timers,
      onProgress: progress => emitted.push({ at: now, progress }),
    })
    const result = downloader.download({ taskId: 'throttled-progress', request: request() })
    await secondPull
    await advance(199)
    expect(emitted.filter(event => event.progress.status === 'downloading')).toHaveLength(1)
    await advance(1)
    expect(emitted.at(-1)).toMatchObject({ at: 200, progress: { status: 'downloading', transferredBytes: 1 } })
    releaseSecondChunk?.()
    await thirdPull
    await advance(199)
    expect(emitted.filter(event => event.progress.status === 'downloading')).toHaveLength(2)
    await advance(1)
    expect(emitted.at(-1)).toMatchObject({ at: 400, progress: { status: 'downloading', transferredBytes: 2 } })
    finishBody?.()
    await result
    const downloadingTimes = emitted
      .filter(event => event.progress.status === 'downloading')
      .map(event => event.at)
    expect(downloadingTimes).toEqual([0, 200, 400])
    expect(emitted.slice(-2).map(event => event.progress.status)).toEqual(['verifying', 'completed'])
  })

  it.each(['', '.', '..', '../file', 'dir/file', 'dir\\file', 'bad\0file'])('rejects unsafe fileName %j', async (fileName) => {
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: vi.fn<typeof fetch>() })
    await expect(downloader.download({ taskId: 'invalid-name', request: request({ fileName }) })).rejects.toBeInstanceOf(TypeError)
  })

  it.each(['', '.', '..', '../task', 'dir/task', 'dir\\task', 'bad\0task'])('rejects unsafe taskId %j', async (taskId) => {
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: vi.fn<typeof fetch>() })
    await expect(downloader.download({ taskId, request: request() })).rejects.toBeInstanceOf(TypeError)
  })

  it('rejects empty sources, non-HTTPS URLs, and non-positive maxBytes', async () => {
    const downloader = new HttpArtifactDownloader({ rootDir, fetch: vi.fn<typeof fetch>() })
    await expect(downloader.download({ taskId: 'empty', request: request({ sources: [] }) })).rejects.toBeInstanceOf(TypeError)
    await expect(downloader.download({ taskId: 'http', request: request({ sources: [{ id: 'bad', url: 'http://example/file' }] }) })).rejects.toBeInstanceOf(TypeError)
    await expect(downloader.download({ taskId: 'limit', request: request({ maxBytes: 0 }) })).rejects.toBeInstanceOf(TypeError)
  })
})

const seedPartial = async (rootDir: string, taskId: string, contents: string): Promise<void> => {
  const partialDirectory = path.join(rootDir, 'partial')
  await mkdir(partialDirectory, { recursive: true })
  await writeFile(path.join(partialDirectory, `${taskId}.part`), contents)
}
