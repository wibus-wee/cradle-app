import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 10_000

export class SettingsPage {
  constructor(private readonly page: Page) {}

  sidebar() {
    return this.page.locator('[data-testid="app-sidebar"]')
  }

  async expectSettingsMode(): Promise<void> {
    await expect(this.sidebar()).toHaveAttribute('data-sidebar-mode', 'settings', { timeout: TIMEOUT })
    await expect(this.page.locator('[data-testid="settings-nav-appearance"]')).toBeVisible({ timeout: TIMEOUT })
  }

  async expectAppearancePage(): Promise<void> {
    const settings = this.page.locator('[data-testid="appearance-settings"]')
    await expect(settings).toBeVisible({ timeout: TIMEOUT })
    await expect(settings).toHaveAttribute('data-settings-appearance-ready', 'true', { timeout: TIMEOUT })
  }
}
