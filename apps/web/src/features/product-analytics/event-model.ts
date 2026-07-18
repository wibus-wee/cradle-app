import type { SurfaceKind } from '~/navigation/surface-identity'

export type ProductFeatureDomain
  = | 'chat'
    | 'work'
    | 'workspace'
    | 'diff'
    | 'kanban'
    | 'await'
    | 'automation'
    | 'plugins'
    | 'jarvis'

export type ProductAnalyticsOutcome = 'success' | 'failed' | 'cancelled'

/** Opaque server-issued IDs used to join product tasks with AI telemetry. */
export interface ProductAnalyticsCorrelation {
  session_id: string
  run_id: string
}

export type ProductAnalyticsFailureCategory
  = | 'configuration'
    | 'network'
    | 'permission'
    | 'provider'
    | 'unknown'
    | 'validation'

export type ProductAnalyticsDurationBucket
  = | 'under_10s'
    | '10s_30s'
    | '30s_2m'
    | '2m_10m'
    | 'over_10m'

export type ProductAnalyticsTask
  = | {
    feature_domain: 'chat'
    task_kind: 'agent_run'
    task_variant: null
  }
  | {
    feature_domain: 'work'
    task_kind: 'work_create'
    task_variant: 'issue' | 'new_work'
  }
  | {
    feature_domain: 'work'
    task_kind: 'draft_submit'
    task_variant: 'create_draft' | 'update_draft'
  }
  | {
    feature_domain: 'work'
    task_kind: 'mark_ready'
    task_variant: null
  }
  | {
    feature_domain: 'workspace'
    task_kind: 'workspace_add'
    task_variant: 'local' | 'remote'
  }

type ProductAnalyticsTaskEvent = ProductAnalyticsTask & Partial<ProductAnalyticsCorrelation>

export interface ProductAnalyticsEventMap {
  app_opened: {
    lifecycle_stage: 'first_seen' | 'returning' | 'updated'
    previous_version: string | null
  }
  surface_viewed: {
    surface: SurfaceKind
    feature_domain: ProductFeatureDomain | null
  }
  onboarding_completed: Record<string, never>
  task_started: ProductAnalyticsTaskEvent
  task_finished: ProductAnalyticsTaskEvent & {
    outcome: ProductAnalyticsOutcome
    duration_bucket: ProductAnalyticsDurationBucket
    failure_category: ProductAnalyticsFailureCategory | null
  }
}

export function featureDomainForSurface(surface: SurfaceKind): ProductFeatureDomain | null {
  switch (surface) {
    case 'new-chat':
    case 'chat':
      return 'chat'
    case 'new-work':
    case 'work':
    case 'pull-requests':
      return 'work'
    case 'workspace':
      return 'workspace'
    case 'diff':
    case 'workspace-diffs':
      return 'diff'
    case 'kanban':
      return 'kanban'
    case 'awaits':
      return 'await'
    case 'automation':
      return 'automation'
    case 'plugin':
    case 'plugin-center':
      return 'plugins'
    default:
      return null
  }
}

export function bucketProductAnalyticsDuration(durationMs: number): ProductAnalyticsDurationBucket {
  if (durationMs < 10_000) {
    return 'under_10s'
  }
  if (durationMs < 30_000) {
    return '10s_30s'
  }
  if (durationMs < 120_000) {
    return '30s_2m'
  }
  if (durationMs < 600_000) {
    return '2m_10m'
  }
  return 'over_10m'
}

/**
 * Coarse failure taxonomy for product analytics only.
 * Prefer machine-readable status/code/name signals; never store raw error text.
 */
export function classifyProductAnalyticsFailure(error: unknown): ProductAnalyticsFailureCategory {
  const signals = collectFailureSignals(error)
  if (signals.statuses.some(status => status === 401 || status === 403)) {
    return 'permission'
  }
  if (signals.statuses.some(status => status === 400 || status === 422)) {
    return 'validation'
  }
  if (signals.codes.some(code => /permission|forbidden|unauthorized|auth/i.test(code))) {
    return 'permission'
  }
  if (signals.codes.some(code => /valid|invalid|required|schema|dirty|unavailable/i.test(code))) {
    return 'validation'
  }
  if (signals.codes.some(code => /config|misconfig|missing|not[_-]?found|unsupported/i.test(code))) {
    return 'configuration'
  }
  if (signals.codes.some(code => /provider|model|runtime|llm|openai|anthropic|codex/i.test(code))) {
    return 'provider'
  }
  if (
    signals.names.some(name => /network|typeerror|fetch/i.test(name))
    || signals.codes.some(code => /network|timeout|econn|enotfound|fetch/i.test(code))
    || signals.messages.some(message => /failed to fetch|networkerror|load failed|timed out|timeout|net::/i.test(message))
  ) {
    return 'network'
  }
  if (signals.messages.some(message => /permission|forbidden|unauthorized|not allowed/i.test(message))) {
    return 'permission'
  }
  if (signals.messages.some(message => /invalid|required|validation|must /i.test(message))) {
    return 'validation'
  }
  if (signals.messages.some(message => /provider|model|runtime|api key|quota|rate limit/i.test(message))) {
    return 'provider'
  }
  if (signals.messages.some(message => /config|not configured|missing|unsupported/i.test(message))) {
    return 'configuration'
  }
  return 'unknown'
}

function collectFailureSignals(error: unknown): {
  codes: string[]
  messages: string[]
  names: string[]
  statuses: number[]
} {
  const codes: string[] = []
  const messages: string[] = []
  const names: string[] = []
  const statuses: number[] = []
  const seen = new Set<unknown>()

  const visit = (value: unknown, depth: number) => {
    if (value == null || depth > 3 || seen.has(value)) {
      return
    }
    if (typeof value === 'string') {
      if (value.trim()) {
        messages.push(value)
      }
      return
    }
    if (typeof value !== 'object') {
      return
    }
    seen.add(value)

    if (value instanceof Error) {
      names.push(value.name)
      if (value.message.trim()) {
        messages.push(value.message)
      }
      visit((value as Error & { cause?: unknown }).cause, depth + 1)
    }

    const record = value as Record<string, unknown>
    if (typeof record.name === 'string' && record.name.trim()) {
      names.push(record.name)
    }
    if (typeof record.code === 'string' && record.code.trim()) {
      codes.push(record.code)
    }
    if (typeof record.status === 'number' && Number.isFinite(record.status)) {
      statuses.push(record.status)
    }
    if (typeof record.statusCode === 'number' && Number.isFinite(record.statusCode)) {
      statuses.push(record.statusCode)
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      messages.push(record.message)
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      messages.push(record.error)
    }
    if (record.error && typeof record.error === 'object') {
      visit(record.error, depth + 1)
    }
    if (record.cause) {
      visit(record.cause, depth + 1)
    }
  }

  visit(error, 0)
  return { codes, messages, names, statuses }
}
