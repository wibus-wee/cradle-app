import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000

export class UsagePage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.locator('[data-testid="usage-dashboard"]')
  }

  async open(): Promise<void> {
    const nav = this.page.locator('[data-testid="nav-usage"]')
    await expect(nav).toBeVisible({ timeout: TIMEOUT })
    await nav.click()
    await expect(this.root()).toBeVisible({ timeout: TIMEOUT })
  }

  async expectExactTotals(tokens: number, turns: number): Promise<void> {
    await expect(this.page.locator('[data-testid="usage-total-tokens"]'))
      .toHaveText(String(tokens), { timeout: TIMEOUT })
    await expect(this.page.locator('[data-testid="usage-hero-turns"]'))
      .toContainText(String(turns), { timeout: TIMEOUT })
  }
}
