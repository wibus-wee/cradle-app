/**
 * Projects Kimi OAuth usage (`/api/v1/oauth/usage`) into the runtime-neutral usage UI slot.
 * Accepts both the current `name`/`reset_at`/`window` shape and the legacy
 * `label`/`reset_hint` fields so resumed hosts on older Kimi builds still render.
 */

import type { RuntimeUsageUiSlotState } from '../../chat-runtime/runtime-provider-types'

type KimiOauthUsageLimit = {
  limit: number
  used: number
  name?: string
  label?: string
  reset_at?: string
  reset_hint?: string
  window?: {
    duration: number
    unit: 'minute' | 'hour' | 'day' | 'week'
  }
}

type KimiOauthUsageOk = {
  kind: 'ok'
  limits: KimiOauthUsageLimit[]
  summary: KimiOauthUsageLimit | null
  extra_usage: {
    balance_cents: number
    currency: string
    monthly_charge_limit_cents: number
    monthly_charge_limit_enabled: boolean
    monthly_used_cents: number
    total_cents: number
  } | null
}

export function projectKimiOauthUsageSlotState(input: {
  threadId: string
  data: unknown
  updatedAt?: number
}): RuntimeUsageUiSlotState | null {
  const payload = readOauthUsageOk(input.data)
  if (!payload) {
    return null
  }

  const primary = payload.summary ?? payload.limits[0] ?? null
  const secondary = payload.summary && payload.limits[0] && payload.limits[0] !== payload.summary
    ? payload.limits[0]
    : (payload.limits[1] ?? null)
  const credits = payload.extra_usage

  return {
    kind: 'usage',
    slotId: 'kimi:usage',
    threadId: input.threadId,
    limitName: readLimitName(primary),
    usedPercent: readUsedPercent(primary),
    primaryWindowDurationMins: readWindowMinutes(primary),
    primaryResetsAt: readResetAtSeconds(primary),
    secondaryUsedPercent: readUsedPercent(secondary),
    secondaryWindowDurationMins: readWindowMinutes(secondary),
    secondaryResetsAt: readResetAtSeconds(secondary),
    creditsBalance: credits ? formatCentsBalance(credits.balance_cents, credits.currency) : null,
    hasCredits: credits ? credits.balance_cents > 0 : null,
    rateLimitReachedType: null,
    planType: null,
    updatedAt: input.updatedAt ?? Date.now(),
  }
}

function readOauthUsageOk(data: unknown): KimiOauthUsageOk | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const record = data as {
    kind?: unknown
    limits?: unknown
    summary?: unknown
    extra_usage?: unknown
  }
  if (record.kind !== 'ok' || !Array.isArray(record.limits)) {
    return null
  }
  return {
    kind: 'ok',
    limits: record.limits.filter(isUsageLimit),
    summary: isUsageLimit(record.summary) ? record.summary : null,
    extra_usage: isExtraUsage(record.extra_usage) ? record.extra_usage : null,
  }
}

function isUsageLimit(value: unknown): value is KimiOauthUsageLimit {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as { limit?: unknown, used?: unknown }
  return typeof record.limit === 'number' && typeof record.used === 'number'
}

function isExtraUsage(value: unknown): value is NonNullable<KimiOauthUsageOk['extra_usage']> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as { balance_cents?: unknown, currency?: unknown }
  return typeof record.balance_cents === 'number' && typeof record.currency === 'string'
}

function readLimitName(limit: KimiOauthUsageLimit | null): string | null {
  if (!limit) {
    return null
  }
  if (typeof limit.name === 'string' && limit.name.trim()) {
    return limit.name
  }
  if (typeof limit.label === 'string' && limit.label.trim()) {
    return limit.label
  }
  return null
}

function readUsedPercent(limit: KimiOauthUsageLimit | null): number | null {
  if (!limit || !(limit.limit > 0)) {
    return null
  }
  return Math.max(0, Math.min(100, (limit.used / limit.limit) * 100))
}

function readWindowMinutes(limit: KimiOauthUsageLimit | null): number | null {
  const window = limit?.window
  if (!window || typeof window.duration !== 'number' || !(window.duration > 0)) {
    return null
  }
  switch (window.unit) {
    case 'minute':
      return window.duration
    case 'hour':
      return window.duration * 60
    case 'day':
      return window.duration * 1_440
    case 'week':
      return window.duration * 10_080
    default:
      return null
  }
}

function readResetAtSeconds(limit: KimiOauthUsageLimit | null): number | null {
  if (!limit?.reset_at || typeof limit.reset_at !== 'string') {
    return null
  }
  const ms = Date.parse(limit.reset_at)
  return Number.isFinite(ms) ? Math.floor(ms / 1_000) : null
}

function formatCentsBalance(balanceCents: number, currency: string): string {
  const amount = (balanceCents / 100).toFixed(2)
  return currency ? `${amount} ${currency}` : amount
}
