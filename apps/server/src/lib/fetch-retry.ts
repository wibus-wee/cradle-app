import { z } from 'zod'

export interface FetchRetryOptions {
  /** Max number of retries. Default 3. */
  maxRetries?: number
  /** Base delay in ms for exponential backoff. Default 1000. */
  baseDelay?: number
  /** Max delay in ms. Default 30000. */
  maxDelay?: number
  /** HTTP status codes that should trigger retry. Default [429, 500, 502, 503, 504]. */
  retryableStatuses?: number[]
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504]
const FetchRetryOptionsSchema = z.object({
  maxRetries: z.number().int().nonnegative().default(3),
  baseDelay: z.number().finite().nonnegative().default(1000),
  maxDelay: z.number().finite().nonnegative().default(30_000),
  retryableStatuses: z.array(z.number().int()).default(DEFAULT_RETRYABLE_STATUSES),
}).prefault({})

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    error.name === 'TypeError'
    || error.message.includes('ECONNREFUSED')
    || error.message.includes('ECONNRESET')
    || error.message.includes('ETIMEDOUT')
    || error.message.includes('ENOTFOUND')
    || error.message.includes('fetch failed')
  )
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const retryOptions = FetchRetryOptionsSchema.parse(options)
  const signal = init?.signal as AbortSignal | undefined

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    try {
      const response = await fetch(url, init)
      if (!retryOptions.retryableStatuses.includes(response.status) || attempt === retryOptions.maxRetries) {
        return response
      }
    }
    catch (error) {
      if (signal?.aborted) {
        throw error
      }
      if (!isNetworkError(error) || attempt === retryOptions.maxRetries) {
        throw error
      }
    }

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    const delay = Math.min(retryOptions.baseDelay * 2 ** attempt, retryOptions.maxDelay)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay)
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  throw new Error('fetchWithRetry: exhausted all retries')
}
