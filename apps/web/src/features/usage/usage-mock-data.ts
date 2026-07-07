// ─────────────────────────────────────────────────────────────────────────
// MOCK DATA — everything in this file is illustrative placeholder data, not
// real telemetry. It exists so the redesigned Usage dashboard can ship with
// a complete, lively layout instead of empty gaps while the backend catches
// up. Each export documents exactly which endpoint would replace it.
//
// Backend follow-ups needed to make these real:
//   1. Hour-of-day distribution — `usage_logs.createdAt` has the raw unix
//      timestamp, but no endpoint aggregates it by hour-of-day. Needs
//      something like `GET /usage/patterns/hourly` grouping by
//      `strftime('%H', created_at, 'unixepoch', 'localtime')`.
//   2. Recent sessions list — `GET /usage/cost/sessions` already returns real
//      per-session cost/tokens, but only `sessionId` (no title, agent name,
//      model, or timestamp). Needs a join against `sessions` / `agents` /
//      `workspaces` to expose human-readable rows, e.g.
//      `GET /usage/sessions/recent`.
// ─────────────────────────────────────────────────────────────────────────

import type { UsageSummary } from './use-usage-overview'

export interface HourOfDayBucket {
  hour: number
  tokens: number
}

/**
 * MOCK: shapes a plausible "most active in the afternoon/evening" curve and
 * scales it to the user's real total so the numbers feel proportionate, even
 * though the hour-by-hour split itself is synthetic.
 */
export function mockHourOfDayDistribution(totalTokens: number): HourOfDayBucket[] {
  // Relative weights per hour (0-23), roughly bell-shaped around the workday.
  const weights = [
    0.2,
0.1,
0.1,
0.1,
0.1,
0.2,
0.4,
0.8,
    1.6,
2.4,
2.8,
2.6,
2.2,
2.4,
2.8,
3.0,
    3.2,
2.8,
2.2,
1.8,
1.4,
1.0,
0.6,
0.3,
  ]
  const weightTotal = weights.reduce((sum, w) => sum + w, 0)
  return weights.map((weight, hour) => ({
    hour,
    tokens: Math.round((weight / weightTotal) * totalTokens),
  }))
}

export interface MockRecentSession {
  id: string
  title: string
  agentName: string
  modelId: string
  tokens: number
  costUsd: number
  turns: number
  relativeTime: string
}

const SAMPLE_SESSION_TITLES = [
  'Refactor billing module',
  'Investigate flaky e2e test',
  'Draft release notes',
  'Design review follow-up',
  'Migrate usage dashboard',
  'Debug relay timeout',
]

const SAMPLE_RELATIVE_TIMES = ['2 hours ago', 'yesterday', '2 days ago', '3 days ago', 'last week', 'last week']

/**
 * MOCK: fabricates session-level rows shaped like the real
 * `GET /usage/cost/sessions` response but with human-readable titles/timing
 * that endpoint doesn't return yet. Splits a plausible slice of the user's
 * real cost/token totals across sample sessions using a power-law falloff so
 * the ranking still feels grounded, while making the section's job (this is
 * a sample, not your real session history) obvious via its "Preview" badge.
 */
export function mockRecentSessions(summary: UsageSummary | null): MockRecentSession[] {
  const modelIds = summary && summary.byModel.length > 0
    ? summary.byModel.map(model => model.modelId)
    : ['gpt-5', 'claude-opus-4', 'gemini-2.5-pro']
  const agentNames = summary && summary.byAgent.length > 0
    ? summary.byAgent.map(agent => agent.agentName)
    : ['Cradle']
  const totalTokens = summary?.totalTokens ?? 120_000
  const sampleTokenPool = totalTokens * 0.35

  const fallbackShares = [0.34, 0.24, 0.16, 0.11, 0.09, 0.06]
  return SAMPLE_SESSION_TITLES.map((title, index) => {
    const share = fallbackShares[index] ?? 0.05
    const tokens = Math.max(400, Math.round(sampleTokenPool * share))
    return {
      id: `sample-session-${index}`,
      title,
      agentName: agentNames[index % agentNames.length],
      modelId: modelIds[index % modelIds.length],
      tokens,
      costUsd: (tokens / 1_000_000) * 6.5,
      turns: Math.max(1, Math.round(tokens / 2_400)),
      relativeTime: SAMPLE_RELATIVE_TIMES[index] ?? 'earlier',
    }
  })
}
