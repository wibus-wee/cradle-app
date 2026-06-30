import { resolve } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

const ROOT = resolve(__dirname, '..', '..', '..')
const DESKTOP_PATH = resolve(ROOT, 'apps', 'desktop')

let app: ElectronApplication | null = null
let mainPage: Page | null = null

/**
 * Launch the Electron app for E2E testing.
 * Requires `apps/desktop` to be built first (`pnpm --filter @cradle/desktop build`).
 */
export async function launchElectronApp(): Promise<{ app: ElectronApplication, page: Page }> {
  // Dynamic import to avoid requiring electron in web-only test runs
  const { _electron } = await import('@playwright/test')

  app = await _electron.launch({
    args: [resolve(DESKTOP_PATH, 'dist/main/index.js')],
    cwd: DESKTOP_PATH,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  })

  mainPage = await app.firstWindow()
  await mainPage.waitForLoadState('domcontentloaded')

  return { app, page: mainPage }
}

/**
 * Close the Electron app.
 */
export async function closeElectronApp(): Promise<void> {
  if (app) {
    await app.close()
    app = null
    mainPage = null
  }
}

/**
 * Get the current Electron app instance (or null).
 */
export function getElectronApp(): ElectronApplication | null {
  return app
}

/**
 * Get the main window page (or null).
 */
export function getMainPage(): Page | null {
  return mainPage
}

/**
 * Whether we're running in Electron mode.
 * Set via E2E_MODE=electron env var.
 */
export function isElectronMode(): boolean {
  return process.env.E2E_MODE === 'electron'
}
