import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

import { app } from 'electron'

const DEFAULT_DEV_CHROMIUM_ARGS = ['--remote-debugging-port=9222']

/**
 * Load `apps/desktop/.env` into the main process `process.env` during development.
 *
 * `electron-vite dev` does not inject `.env` files into the main process at
 * runtime — it only exposes `*_VITE_`-prefixed vars to `import.meta.env`. The
 * forked server (see `server-process.ts`) inherits `process.env` and picks up
 * observability keys via `pickDesktopServerObservabilityEnv`, so anything that
 * should reach the server (telemetry, langfuse, diagnostics) must live on the
 * main process env. Loading the local `.env` here makes `pnpm dev` carry those
 * fields automatically.
 *
 * Shell-provided variables win: existing `process.env` entries are never
 * overridden. No-op in production builds — packaged builds apply compile-time
 * defaults via `applyDesktopPackagedObservabilityEnv` instead.
 */
export function loadDesktopDevEnv(): void {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  if (!isDev) {
    return
  }

  const envPath = resolve(process.cwd(), '.env')
  let parsed: NodeJS.Dict<string>
  try {
    parsed = parseEnv(readFileSync(envPath, 'utf8'))
  }
  catch {
    // No local .env in this dev checkout — nothing to load.
    return
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

export function applyDesktopDevChromiumArgs(): void {
  if (!process.env.ELECTRON_RENDERER_URL) {
    return
  }

  const configuredArgs = process.env.CRADLE_DESKTOP_DEV_CHROMIUM_ARGS?.trim().split(/\s+/).filter(Boolean) ?? []
  for (const arg of [...DEFAULT_DEV_CHROMIUM_ARGS, ...configuredArgs]) {
    if (!arg.startsWith('--')) {
      continue
    }
    const body = arg.slice(2)
    const separatorIndex = body.indexOf('=')
    if (separatorIndex === -1) {
      app.commandLine.appendSwitch(body)
      continue
    }
    app.commandLine.appendSwitch(body.slice(0, separatorIndex), body.slice(separatorIndex + 1))
  }
}
