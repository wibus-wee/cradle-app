import type { MarketplaceEntry } from './catalog'
import { fetchMarketplace } from './catalog'

export interface MarketplaceListResult {
  plugins: MarketplaceEntry[]
  stale: boolean
  fetchedAt: number | null
}

export async function listMarketplace(): Promise<MarketplaceListResult> {
  const snapshot = await fetchMarketplace()
  return {
    plugins: snapshot.entries,
    stale: snapshot.stale,
    fetchedAt: snapshot.fetchedAt,
  }
}

export async function refreshMarketplace(): Promise<MarketplaceListResult> {
  const snapshot = await fetchMarketplace(true)
  return {
    plugins: snapshot.entries,
    stale: snapshot.stale,
    fetchedAt: snapshot.fetchedAt,
  }
}
