import { githubApiCache } from '@cradle/db'
import { eq, lt } from 'drizzle-orm'

import { db } from '../infra'

const DEFAULT_TTL_S = 60 * 60 // 1 hour

export function getCached<T>(key: string): { data: T, etag: string | null } | null {
  const row = db().select().from(githubApiCache).where(eq(githubApiCache.cacheKey, key)).get()
  if (!row) {
    return null
  }
  return {
    data: JSON.parse(row.dataJson) as T,
    etag: row.etag,
  }
}

export function isCacheStale(key: string, ttlS = DEFAULT_TTL_S): boolean {
  const row = db().select({ fetchedAt: githubApiCache.fetchedAt }).from(githubApiCache).where(eq(githubApiCache.cacheKey, key)).get()
  if (!row) {
    return true
  }
  const now = Math.floor(Date.now() / 1000)
  return (now - row.fetchedAt) > ttlS
}

export function setCache(key: string, data: unknown, etag?: string | null): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(githubApiCache).values({
    cacheKey: key,
    dataJson: JSON.stringify(data),
    etag: etag ?? null,
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: githubApiCache.cacheKey,
    set: {
      dataJson: JSON.stringify(data),
      etag: etag ?? null,
      fetchedAt: now,
    },
  }).run()
}

export function deleteCache(key: string): void {
  db().delete(githubApiCache).where(eq(githubApiCache.cacheKey, key)).run()
}

export interface CachedFetchResult<T> {
  data: T | null
  etag?: string | null
  status: number
}

export interface CachedFetchOptions<T> {
  cacheKey: string
  ttlS?: number
  etag?: boolean
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>
}

export async function cachedFetch<T>(options: CachedFetchOptions<T>): Promise<T | null> {
  const { cacheKey, ttlS = 60, etag = true, fetcher } = options

  if (!isCacheStale(cacheKey, ttlS)) {
    const cached = getCached<T>(cacheKey)
    if (cached) { return cached.data }
  }

  const existingEtag = etag ? getCached(cacheKey)?.etag ?? null : null
  const result = await fetcher(existingEtag)

  if (result.status === 304) {
    const cached = getCached<T>(cacheKey)
    return cached?.data ?? null
  }

  if (result.data === null) {
    return null
  }

  setCache(cacheKey, result.data, result.etag ?? null)
  return result.data
}

export function pruneStaleCache(ttlS = DEFAULT_TTL_S * 24): number {
  const threshold = Math.floor(Date.now() / 1000) - ttlS
  const stale = db().select({ key: githubApiCache.cacheKey }).from(githubApiCache).where(lt(githubApiCache.fetchedAt, threshold)).all()
  for (const row of stale) {
    db().delete(githubApiCache).where(eq(githubApiCache.cacheKey, row.key)).run()
  }
  return stale.length
}
