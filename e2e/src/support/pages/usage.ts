import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000

export type UsageRangeKey = '7d' | '30d' | '90d' | '1y'

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

  async selectRange(range: UsageRangeKey): Promise<void> {
    const control = this.page.locator(`[data-testid="usage-range-${range}"]`)
    await expect(control).toBeVisible({ timeout: TIMEOUT })
    await control.click()
    await this.expectRange(range)
  }

  async expectRange(range: UsageRangeKey): Promise<void> {
    await expect(this.page.locator(`[data-testid="usage-range-${range}"]`))
      .toHaveAttribute('data-state', 'on', { timeout: TIMEOUT })
  }

  async exportCsv(): Promise<{ fileName: string, content: string }> {
    const downloadPromise = this.page.waitForEvent('download')
    await this.page.locator('[data-testid="usage-export-csv"]').click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    if (!stream) {
      throw new Error('Usage CSV download did not expose a readable stream')
    }
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return {
      fileName: download.suggestedFilename(),
      content: Buffer.concat(chunks).toString('utf8'),
    }
  }
}
