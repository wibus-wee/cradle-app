import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000

export class DiffPage {
  constructor(private readonly page: Page) {}

  workingTree(): Locator {
    return this.page.locator('[data-testid="review-detail-page"]')
  }

  async openFromNav(): Promise<void> {
    await this.page.locator('[data-testid="nav-diffs"]').click()
    await expect(this.page.locator('[data-testid="diffs-index-view"]')).toBeVisible({ timeout: TIMEOUT })
  }

  async openWorkingTree(): Promise<void> {
    const button = this.page.locator('[data-testid="diffs-open-working-tree"]')
    await expect(button).toBeVisible({ timeout: TIMEOUT })
    await button.click()
    await expect(this.workingTree()).toBeVisible({ timeout: TIMEOUT })
  }

  async expectFile(path: string): Promise<void> {
    await expect(this.workingTree().locator('[data-testid="review-file-list"]').getByText(path, { exact: true }))
      .toBeVisible({ timeout: TIMEOUT })
  }

  async expectContent(content: string): Promise<void> {
    await expect(this.workingTree()).toContainText(content, { timeout: TIMEOUT })
  }

  async refresh(): Promise<void> {
    const refresh = this.page.locator('[data-testid="review-top-bar"]').getByRole('button', { name: 'Refresh' })
    await expect(refresh).toBeEnabled({ timeout: TIMEOUT })
    await refresh.click()
    await expect(refresh).toBeEnabled({ timeout: TIMEOUT })
  }
}
