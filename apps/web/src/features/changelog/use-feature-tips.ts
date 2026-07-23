// Feature tips fetching for the corner popup (i18n-aware).
// Tips are predefined on the landing site (`apps/landing/tips/index.json`)
// and pushed to users without an app release.
import { useQuery } from '@tanstack/react-query'

const TIPS_BASE_URL = 'https://app.cradle.wibus.ren/tips'

export interface FeatureTip {
  /** Stable unique id — dismissal is keyed by it. Bump to re-show a changed tip. */
  id: string
  title: Record<string, string>
  body: Record<string, string>
  /** CTA label; falls back to a generic "Try it" when absent. */
  cta?: Record<string, string>
  /** Where "Try it" leads: in-app route (`/settings/...`) or external https URL. */
  url: string
  /** ISO date; the tip only appears on/after this date. */
  showAfter?: string
  /** ISO date; the tip stops appearing after this date. */
  showUntil?: string
}

export const FEATURE_TIPS_QUERY_KEY = ['feature-tips', 'index'] as const

/** Dev-only: append mock tips so the tip card is previewable offline. */
async function withDevMockTips(tips: FeatureTip[]): Promise<FeatureTip[]> {
  if (!import.meta.env.DEV) { return tips }
  const { devMockFeatureTips } = await import('./whats-new-dev-mocks')
  const mockIds = new Set(devMockFeatureTips.map(t => t.id))
  return [...devMockFeatureTips, ...tips.filter(t => !mockIds.has(t.id))]
}

async function fetchFeatureTips(): Promise<FeatureTip[]> {
  try {
    const res = await fetch(`${TIPS_BASE_URL}/index.json`)
    if (!res.ok) { throw new Error(`Failed to fetch feature tips: ${res.status}`) }
    return withDevMockTips(await res.json())
  }
  catch (error) {
    // Tips are a nice-to-have; network failures stay silent. In dev, fall
    // back to mocks alone so previews work offline.
    if (import.meta.env.DEV) { return withDevMockTips([]) }
    throw error
  }
}

export function useFeatureTips() {
  return useQuery({
    queryKey: FEATURE_TIPS_QUERY_KEY,
    queryFn: fetchFeatureTips,
    staleTime: 1000 * 60 * 30, // 30 minutes
    retry: 1,
  })
}

function todayLocalISODate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Newest-first undismissed tip inside its active window. */
export function findPendingTip(
  tips: FeatureTip[] | undefined,
  dismissed: string[],
): FeatureTip | null {
  if (!tips) { return null }
  const today = todayLocalISODate()
  return tips.find(tip =>
    !dismissed.includes(tip.id)
    && (tip.showAfter === undefined || today >= tip.showAfter)
    && (tip.showUntil === undefined || today <= tip.showUntil)) ?? null
}
