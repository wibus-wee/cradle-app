import { z } from 'zod'

import { outboundFetch } from '../../lib/outbound-network'
import type { BackgroundActivityFooterPresentation } from '../background-activity/service'
import type { MaintenanceRunContext } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'

const CODEX_RESET_STATUS_URL = 'https://codex-resets.com/api/v1/status'
const REFRESH_INTERVAL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

const sourceSchema = z.object({
  type: z.enum(['x_post', 'observed']),
  url: z.url().optional(),
}).passthrough()

const resetSchema = z.object({
  id: z.string().min(1),
  announced_at: z.iso.datetime(),
}).passthrough()

const watchSchema = z.object({
  level: z.enum(['elevated', 'strong']),
  reset_chance_percent: z.number().int().min(0).max(100).nullable(),
  forecast_window: z.string().min(1),
  observed_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  source: sourceSchema,
}).passthrough()

const statusSchema = z.object({
  data: z.object({
    latest_reset: resetSchema.nullable(),
    active_watch: watchSchema.nullable(),
  }).passthrough(),
  meta: z.object({
    generated_at: z.iso.datetime(),
  }).passthrough(),
}).passthrough()

type CodexResetStatus = z.infer<typeof statusSchema>
type FetchLike = typeof outboundFetch

let cachedEtag: string | null = null
let cachedStatus: CodexResetStatus | null = null
let fetchOverride: FetchLike | null = null

function noticeId(status: CodexResetStatus): string | null {
  const watch = status.data.active_watch
  if (!watch) {
    return null
  }
  return `codex-reset-watch:${watch.source.url ?? watch.observed_at}`
}

export function projectCodexResetFooterPresentation(
  status: CodexResetStatus,
  now = Date.now(),
): BackgroundActivityFooterPresentation | null {
  const watch = status.data.active_watch
  if (!watch) {
    return null
  }

  const observedAt = Date.parse(watch.observed_at)
  const expiresAt = Date.parse(watch.expires_at)
  const latestResetAt = status.data.latest_reset
    ? Date.parse(status.data.latest_reset.announced_at)
    : null
  if (expiresAt <= now || (latestResetAt !== null && latestResetAt >= observedAt)) {
    return null
  }

  const id = noticeId(status)
  if (!id) {
    return null
  }

  const chance = watch.reset_chance_percent === null
    ? null
    : `${watch.reset_chance_percent}% chance`
  return {
    id,
    title: 'Codex reset watch',
    description: [chance, watch.forecast_window].filter(Boolean).join(' '),
    actionLabel: watch.source.url ? 'View source' : null,
    actionUrl: watch.source.url ?? null,
    expiresAt,
  }
}

async function readStatus(): Promise<CodexResetStatus> {
  const headers = new Headers({
    'accept': 'application/json',
    'user-agent': 'Cradle codex-reset-watch/1.0',
  })
  if (cachedEtag) {
    headers.set('if-none-match', cachedEtag)
  }

  const response = await (fetchOverride ?? outboundFetch)(CODEX_RESET_STATUS_URL, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (response.status === 304 && cachedStatus) {
    return cachedStatus
  }
  if (!response.ok) {
    throw new Error(`Codex reset status request failed with ${response.status}`)
  }

  const status = statusSchema.parse(await response.json())
  cachedStatus = status
  cachedEtag = response.headers.get('etag')
  return status
}

async function refresh(context: MaintenanceRunContext): Promise<Record<string, string | number | boolean | null>> {
  const status = await readStatus()
  const presentation = projectCodexResetFooterPresentation(status, context.now)
  context.presentInFooter(presentation)
  return {
    activeWatch: presentation !== null,
    noticeId: presentation?.id ?? null,
    generatedAt: status.meta.generated_at,
  }
}

export function registerCodexResetWatchMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'codex-reset-watch',
    key: 'refresh-status',
    title: 'Refresh Codex reset watch',
    priority: 'normal',
    intervalMs: REFRESH_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    maxRunMs: FETCH_TIMEOUT_MS,
    run: refresh,
  })
}

export function setCodexResetWatchFetchForTests(fetch: FetchLike | null): void {
  fetchOverride = fetch
}

export function resetCodexResetWatchCacheForTests(): void {
  cachedEtag = null
  cachedStatus = null
  fetchOverride = null
}
