import type { CachedFetchResult } from '../github-cache'
import {
  getCached,
  isCacheStale,
  setCache,
  touchCache,
} from '../github-cache'
import {
  getGitHubCacheScope,
  getOctokit,
  recordGitHubRateLimit,
  RequestError,
  shouldAvoidGitHubNetwork,
} from './client'
import type { GitHubRepository } from './repository-access'

export type GitHubReadMode = 'read' | 'probe' | 'force'

export interface GitHubCachedReadOptions<T> {
  cacheKey: string
  ttlS?: number
  /** When true (default), send If-None-Match on revalidation. */
  etag?: boolean
  mode?: GitHubReadMode
  repository?: GitHubRepository
  /**
   * When true (default), stale hits return cached data immediately and
   * revalidate in the background. Set false for list feeds that must
   * surface newly created items on the same request.
   */
  swr?: boolean
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Cache-first GitHub read gate:
 * - fresh TTL hit → zero network
 * - stale hit → return stale immediately; background ETag revalidate (SWR)
 * - miss → sync fetch (unless budget is low)
 * - force / probe → sync conditional fetch
 */
export async function cachedGitHubRead<T>(options: GitHubCachedReadOptions<T>): Promise<T | null> {
  const {
    cacheKey,
    ttlS = 60,
    etag = true,
    mode = 'read',
    swr = true,
    fetcher,
  } = options

  const scopedCacheKey = await scopedGitHubCacheKey(cacheKey, options.repository)
  const cached = getCached<T>(scopedCacheKey)
  const fresh = Boolean(cached && !isCacheStale(scopedCacheKey, ttlS))

  if (mode === 'read' && fresh && cached) {
    return cached.data
  }

  // Probe and normal reads must not burn budget; only explicit force may.
  if (mode !== 'force' && cached && shouldAvoidGitHubNetwork()) {
    return cached.data
  }

  if (mode === 'read' && cached && !fresh) {
    if (swr) {
      void coalesce(scopedCacheKey, async () => {
        await revalidate(scopedCacheKey, etag, fetcher)
      })
      return cached.data
    }
    return coalesce(scopedCacheKey, async () => revalidate(scopedCacheKey, etag, fetcher))
  }

  if (mode !== 'force' && shouldAvoidGitHubNetwork() && !cached) {
    return null
  }

  return coalesce(scopedCacheKey, async () => revalidate(scopedCacheKey, etag, fetcher))
}

async function scopedGitHubCacheKey(
  cacheKey: string,
  repository?: GitHubRepository,
): Promise<string> {
  const identityKey = await getGitHubCacheScope(repository)
  return identityKey ? `${cacheKey}:identity:${identityKey}` : cacheKey
}

async function revalidate<T>(
  cacheKey: string,
  useEtag: boolean,
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>,
): Promise<T | null> {
  const existingEtag = useEtag ? getCached(cacheKey)?.etag ?? null : null
  const result = await fetcher(existingEtag)

  if (result.status === 304) {
    touchCache(cacheKey)
    return getCached<T>(cacheKey)?.data ?? null
  }

  if (result.data === null) {
    return getCached<T>(cacheKey)?.data ?? null
  }

  setCache(cacheKey, result.data, result.etag ?? null)
  return result.data
}

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }
  const promise = run().finally(() => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key)
    }
  })
  inFlight.set(key, promise)
  return promise
}

export function clearGitHubReadInFlight(): void {
  inFlight.clear()
}

/** Drop-in replacement for the old github-cache `cachedFetch` used by github-api.ts. */
export async function cachedFetch<T>(options: {
  cacheKey: string
  ttlS?: number
  etag?: boolean
  mode?: GitHubReadMode
  swr?: boolean
  repository?: GitHubRepository
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>
}): Promise<T | null> {
  return cachedGitHubRead(options)
}

export async function octokitRestGet<T>(input: {
  route: string
  params?: Record<string, unknown>
  etag?: string | null
  requireToken?: boolean
  repository?: GitHubRepository
}): Promise<CachedFetchResult<T>> {
  const octokit = await getOctokit({
    requireToken: input.requireToken,
    repository: input.repository,
  })
  try {
    const response = await octokit.request(input.route, {
      ...input.params,
      headers: input.etag
        ? { 'If-None-Match': input.etag }
        : undefined,
    })
    recordGitHubRateLimit(response.headers as Record<string, string | number | undefined>)
    const etagHeader = response.headers.etag ?? response.headers.ETag
    return {
      data: response.data as T,
      etag: typeof etagHeader === 'string' ? etagHeader : null,
      status: response.status,
    }
  }
  catch (error) {
    if (error instanceof RequestError) {
      recordGitHubRateLimit(error.response?.headers as Record<string, string | number | undefined> | undefined)
      if (error.status === 304) {
        return { data: null, etag: null, status: 304 }
      }
    }
    throw error
  }
}
