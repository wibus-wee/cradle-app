import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithRetry } from '../src/lib/fetch-retry'

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it('returns response on success without retries', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

    const result = await fetchWithRetry('https://example.com/api')

    expect(result).toBe(mockResponse)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 status and succeeds', async () => {
    const retryResponse = new Response('rate limited', { status: 429 })
    const successResponse = new Response('ok', { status: 200 })
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(retryResponse)
      .mockResolvedValueOnce(successResponse)

    const promise = fetchWithRetry('https://example.com/api', undefined, { baseDelay: 100 })
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise

    expect(result).toBe(successResponse)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 500 status up to maxRetries', async () => {
    const errorResponse = new Response('error', { status: 500 })
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse)

    const promise = fetchWithRetry('https://example.com/api', undefined, {
      maxRetries: 2,
      baseDelay: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)
    const result = await promise

    expect(result.status).toBe(500)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 400 status', async () => {
    const badRequest = new Response('bad request', { status: 400 })
    globalThis.fetch = vi.fn().mockResolvedValue(badRequest)

    const result = await fetchWithRetry('https://example.com/api')

    expect(result).toBe(badRequest)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on network error', async () => {
    const networkError = new TypeError('fetch failed')
    const successResponse = new Response('ok', { status: 200 })
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(successResponse)

    const promise = fetchWithRetry('https://example.com/api', undefined, { baseDelay: 100 })
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise

    expect(result).toBe(successResponse)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    const networkError = new TypeError('fetch failed')
    globalThis.fetch = vi.fn().mockRejectedValue(networkError)

    controller.abort()

    await expect(
      fetchWithRetry('https://example.com/api', { signal: controller.signal }, { baseDelay: 100 }),
    ).rejects.toThrow()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('respects maxRetries option', async () => {
    const errorResponse = new Response('error', { status: 503 })
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse)

    const promise = fetchWithRetry('https://example.com/api', undefined, {
      maxRetries: 1,
      baseDelay: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise

    expect(result.status).toBe(503)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('caps delay at maxDelay', async () => {
    const errorResponse = new Response('error', { status: 500 })
    const successResponse = new Response('ok', { status: 200 })
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse)

    const promise = fetchWithRetry('https://example.com/api', undefined, {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 1500,
    })

    // First retry: min(1000 * 2^0, 1500) = 1000
    await vi.advanceTimersByTimeAsync(1000)
    // Second retry: min(1000 * 2^1, 1500) = 1500 (capped)
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result).toBe(successResponse)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })
})
