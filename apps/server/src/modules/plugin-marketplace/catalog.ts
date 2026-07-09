import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { guardedFetch } from '../../lib/ssrf-guard'

/**
 * Plugin marketplace catalog.
 *
 * A small, curated, PR-maintained index of plugins (bundled + installable).
 * Unlike `provider-catalog` (a multi-provider dispatcher), this module is a
 * single `guardedFetch` + zod + TTL singleton: fetch the remote JSON, validate
 * it, cache it in-process, and surface a `stale` flag when the cache is served
 * because the latest fetch failed.
 *
 * Search/filter/category are intentionally client-side (the catalog is small).
 */

const DEFAULT_MARKETPLACE_URL = 'https://raw.githubusercontent.com/wibus-wee/cradle-app/main/marketplace.json'
const MARKETPLACE_TTL_MS = 60 * 60 * 1000 // 60 minutes

export const MARKETPLACE_CATEGORIES = ['automation', 'mcp', 'integration', 'skill', 'dev'] as const
export type MarketplaceCategory = typeof MARKETPLACE_CATEGORIES[number]

export interface MarketplaceEntrySource {
  kind: 'git' | 'npm'
  location: string
  ref: string | null
  subPath: string | null
}

export interface MarketplaceEntry {
  id: string
  displayName: string
  description: string
  icon: string | null
  category: MarketplaceCategory
  tags: string[]
  author: { name: string, url: string | null }
  homepage: string | null
  bundled: boolean
  source: MarketplaceEntrySource | null
  featured: boolean
  version: string | null
}

export interface MarketplaceSnapshot {
  entries: MarketplaceEntry[]
  fetchedAt: number
  source: string
  stale: boolean
}

const marketplaceEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string(),
  icon: z.string().url().nullable().catch(null),
  category: z.enum(MARKETPLACE_CATEGORIES),
  tags: z.array(z.string()).catch([]),
  author: z.object({
    name: z.string().min(1),
    url: z.string().nullable().catch(null),
  }),
  homepage: z.string().nullable().catch(null),
  bundled: z.boolean().catch(false),
  source: z
    .object({
      kind: z.enum(['git', 'npm']),
      location: z.string().min(1),
      ref: z.string().nullable().catch(null),
      subPath: z.string().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  featured: z.boolean().catch(false),
  version: z.string().nullable().catch(null),
})

const marketplaceCatalogSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string(),
  plugins: z.array(marketplaceEntrySchema),
})

interface MarketplaceCache {
  entries: MarketplaceEntry[]
  fetchedAt: number
  source: string
}

let cache: MarketplaceCache | null = null

function readMarketplaceUrl(): string {
  const override = process.env.CRADLE_PLUGIN_MARKETPLACE_URL?.trim()
  return override || DEFAULT_MARKETPLACE_URL
}

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < MARKETPLACE_TTL_MS
}

export async function fetchMarketplace(force = false): Promise<MarketplaceSnapshot> {
  if (!force && cache && isFresh(cache.fetchedAt)) {
    return { entries: cache.entries, fetchedAt: cache.fetchedAt, source: cache.source, stale: false }
  }

  const source = readMarketplaceUrl()
  try {
    const response = await guardedFetch(source, {
      headers: { accept: 'application/json' },
    }, {
      blockedHostCode: 'plugin_marketplace_blocked_host',
      invalidSchemeCode: 'plugin_marketplace_invalid_scheme',
      invalidUrlCode: 'plugin_marketplace_invalid_url',
      unresolvedHostCode: 'plugin_marketplace_unresolved_host',
      message: 'Plugin marketplace URL is not allowed',
    })
    if (!response.ok) {
      throw new Error(`Marketplace fetch failed with status ${response.status}.`)
    }

    const parsed = marketplaceCatalogSchema.parse(await response.json())
    const entries: MarketplaceEntry[] = parsed.plugins.map(plugin => ({
      id: plugin.id,
      displayName: plugin.displayName,
      description: plugin.description,
      icon: plugin.icon,
      category: plugin.category,
      tags: plugin.tags,
      author: { name: plugin.author.name, url: plugin.author.url },
      homepage: plugin.homepage,
      bundled: plugin.bundled,
      source: plugin.source,
      featured: plugin.featured,
      version: plugin.version,
    }))

    cache = { entries, fetchedAt: Date.now(), source }
    return { entries: cache.entries, fetchedAt: cache.fetchedAt, source: cache.source, stale: false }
  }
  catch (error) {
    if (cache) {
      return { entries: cache.entries, fetchedAt: cache.fetchedAt, source: cache.source, stale: true }
    }
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError({
      code: 'plugin_marketplace_unavailable',
      status: 503,
      message: 'Plugin marketplace catalog could not be loaded.',
      details: { source, reason: error instanceof Error ? error.message : String(error) },
    })
  }
}

/** Test-only: reset the singleton cache between tests. */
export function resetMarketplaceCacheForTests(): void {
  cache = null
}
