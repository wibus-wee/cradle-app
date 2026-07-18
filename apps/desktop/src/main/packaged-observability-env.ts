import { app } from 'electron'

/**
 * Build-time defaults for packaged desktop observability.
 *
 * Release CI bakes these through `electron.vite.config.ts` so the main process
 * (and the forked server via `pickDesktopServerObservabilityEnv`) can enable
 * PostHog AI Observability without a local `.env`. Shell-provided values win.
 *
 * Product analytics uses `VITE_POSTHOG_*` in the renderer and is independent.
 */
declare const __CRADLE_DESKTOP_PACKAGED_OBSERVABILITY_ENV__: Record<string, string>

function readPackagedDefaults(): Record<string, string> {
  try {
    const baked = __CRADLE_DESKTOP_PACKAGED_OBSERVABILITY_ENV__
    if (!baked || typeof baked !== 'object') {
      return {}
    }
    return baked
  }
  catch {
    return {}
  }
}

/**
 * Apply compile-time observability defaults in packaged builds.
 * No-op while developing (`electron-vite dev`) or when the launcher already
 * set the same keys.
 */
export function applyDesktopPackagedObservabilityEnv(): void {
  if (!app.isPackaged) {
    return
  }

  for (const [key, value] of Object.entries(readPackagedDefaults())) {
    const trimmed = value?.trim()
    if (!trimmed) {
      continue
    }
    if (process.env[key] === undefined) {
      process.env[key] = trimmed
    }
  }
}
