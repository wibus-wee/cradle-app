import type { PostHog } from 'posthog-js/dist/module.slim'

import { isElectron, isTearoffWindow, platform } from '~/lib/electron'

import type {
  ProductAnalyticsEventMap,
  ProductAnalyticsFailureCategory,
  ProductAnalyticsOutcome,
  ProductAnalyticsTask,
} from './event-model'
import { bucketProductAnalyticsDuration } from './event-model'
import { useProductAnalyticsStore } from './store'

export { classifyProductAnalyticsFailure, featureDomainForSurface } from './event-model'

type ProductAnalyticsEventName = keyof ProductAnalyticsEventMap
type ProductAnalyticsProperty = string | number | boolean | null
type ProductAnalyticsProperties = Record<string, ProductAnalyticsProperty>

export interface ProductAnalyticsTaskTimer {
  task: ProductAnalyticsTask
  startedAtMs: number
  settled: boolean
}

interface CaptureProductEventOptions {
  /** Prefer transport that survives page teardown (reload / window close / HMR full reload). */
  unload?: boolean
}

const posthogProjectToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim() ?? ''
const posthogHost = import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com'
const configuredAudience = import.meta.env.VITE_POSTHOG_AUDIENCE?.trim()
const internalActor = import.meta.env.VITE_POSTHOG_INTERNAL_ACTOR?.trim() || null
const buildChannel = import.meta.env.VITE_POSTHOG_BUILD_CHANNEL?.trim()
  || (import.meta.env.DEV ? 'dev' : 'stable')

let posthogClientPromise: Promise<PostHog | null> | null = null
let posthogClient: PostHog | null = null
let unloadHooksInstalled = false
const openTaskTimers = new Set<ProductAnalyticsTaskTimer>()

export function productAnalyticsConfigured(): boolean {
  return posthogProjectToken.length > 0
    && import.meta.env.CRADLE_E2E !== '1'
    && import.meta.env.MODE !== 'test'
}

export function trackProductEvent<Name extends ProductAnalyticsEventName>(
  name: Name,
  properties: ProductAnalyticsEventMap[Name],
  options: CaptureProductEventOptions = {},
): void {
  if (!productAnalyticsConfigured() || !useProductAnalyticsStore.getState().enabled) {
    return
  }

  const payload = {
    ...readCommonProperties(),
    ...(properties as ProductAnalyticsProperties),
  }

  // Unload paths must not wait on the async import; only emit if the client is already ready.
  if (options.unload) {
    if (!posthogClient || !useProductAnalyticsStore.getState().enabled) {
      return
    }
    posthogClient.capture(name, payload, {
      send_instantly: true,
      transport: 'sendBeacon',
    })
    return
  }

  void getPostHogClient().then((client) => {
    if (!client || !useProductAnalyticsStore.getState().enabled) {
      return
    }
    client.capture(name, payload)
  })
}

export function trackProductTaskStarted(
  task: ProductAnalyticsTask,
  startedAtMs = performance.now(),
): ProductAnalyticsTaskTimer {
  installProductAnalyticsUnloadHooks()
  const timer: ProductAnalyticsTaskTimer = {
    task,
    startedAtMs,
    settled: false,
  }
  openTaskTimers.add(timer)
  trackProductEvent('task_started', task)
  return timer
}

export function trackProductTaskFinished(
  timer: ProductAnalyticsTaskTimer,
  outcome: ProductAnalyticsOutcome,
  failureCategory: ProductAnalyticsFailureCategory | null = outcome === 'failed' ? 'unknown' : null,
  options: CaptureProductEventOptions = {},
): void {
  if (timer.settled) {
    return
  }
  timer.settled = true
  openTaskTimers.delete(timer)
  trackProductEvent('task_finished', {
    ...timer.task,
    outcome,
    duration_bucket: bucketProductAnalyticsDuration(performance.now() - timer.startedAtMs),
    failure_category: outcome === 'failed' ? failureCategory ?? 'unknown' : null,
  }, options)
}

/**
 * Close any in-flight product tasks when the renderer is torn down
 * (window close, hard refresh, Vite full reload, Electron webContents reload).
 * Uses `cancelled` rather than `failed` so unload is not counted as product failure.
 */
export function finalizeOpenProductAnalyticsTasks(
  outcome: Extract<ProductAnalyticsOutcome, 'cancelled' | 'failed'> = 'cancelled',
): void {
  if (openTaskTimers.size === 0) {
    return
  }
  for (const timer of [...openTaskTimers]) {
    trackProductTaskFinished(
      timer,
      outcome,
      outcome === 'failed' ? 'unknown' : null,
      { unload: true },
    )
  }
}

export function syncProductAnalyticsEnabled(enabled: boolean): void {
  if (!productAnalyticsConfigured()) {
    return
  }
  if (!enabled && !posthogClientPromise) {
    return
  }

  void getPostHogClient().then((client) => {
    if (!client) {
      return
    }
    if (enabled) {
      client.opt_in_capturing({ captureEventName: false })
      return
    }
    client.opt_out_capturing()
  })
}

function getPostHogClient(): Promise<PostHog | null> {
  if (!posthogClientPromise) {
    posthogClientPromise = initializePostHog()
  }
  return posthogClientPromise
}

async function initializePostHog(): Promise<PostHog | null> {
  if (!productAnalyticsConfigured()) {
    return null
  }

  const { default: posthog } = await import('posthog-js/dist/module.slim')
  posthog.init(posthogProjectToken, {
    api_host: posthogHost,
    autocapture: false,
    capture_exceptions: false,
    capture_pageleave: false,
    capture_pageview: false,
    disable_session_recording: true,
    person_profiles: 'never',
    persistence: 'localStorage',
  })
  posthog.register(readCommonProperties())
  posthogClient = posthog
  installProductAnalyticsUnloadHooks()

  return posthog
}

function installProductAnalyticsUnloadHooks(): void {
  if (unloadHooksInstalled || typeof window === 'undefined') {
    return
  }
  unloadHooksInstalled = true
  const onUnload = () => {
    finalizeOpenProductAnalyticsTasks('cancelled')
  }
  // pagehide is the reliable teardown signal (incl. mobile/bfcache); beforeunload covers desktop reload.
  window.addEventListener('pagehide', onUnload)
  window.addEventListener('beforeunload', onUnload)
}

function readCommonProperties(): ProductAnalyticsProperties {
  const audience = configuredAudience === 'internal' || internalActor || import.meta.env.DEV
    ? 'internal'
    : 'external'

  return {
    app_version: import.meta.env.PACKAGE_VERSION ?? '0.0.0',
    audience,
    build_channel: buildChannel,
    event_schema_version: 2,
    internal_actor: internalActor,
    platform,
    runtime_surface: isElectron ? 'electron' : 'browser',
    window_kind: isTearoffWindow ? 'tearoff' : 'main',
  }
}
