import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 15_000

export class GitPage {
  constructor(private readonly page: Page) {}

  panel() {
    return this.page.locator('[data-testid="git-panel"]')
  }

  branchTrigger() {
    return this.page.locator('[data-testid="git-panel-branch-trigger"]')
  }

  picker() {
    return this.page.locator('[data-testid="git-branch-picker"]')
  }

  async openRightAside(): Promise<void> {
    const aside = this.page.locator('[data-testid="right-aside"]')
    if (await aside.isVisible()) {
      return
    }
    const toggle = this.page.locator('[data-testid="app-header-aside-toggle"]')
    await expect(toggle).toBeVisible({ timeout: TIMEOUT })
    await toggle.click()
    await expect(aside).toBeVisible({ timeout: TIMEOUT })
  }

  async switchToGitTab(): Promise<void> {
    const tab = this.page.locator('[data-testid="right-aside-tab-git"]')
    await expect(tab).toBeVisible({ timeout: TIMEOUT })
    await tab.click()
    await expect(tab).toHaveAttribute('data-active', 'true', { timeout: TIMEOUT })
    await expect(this.panel()).toBeVisible({ timeout: TIMEOUT })
  }

  async waitReady(): Promise<void> {
    await expect(this.panel()).toBeVisible({ timeout: TIMEOUT })
    await expect(this.panel()).toHaveAttribute('data-right-aside-git-ready', 'true', { timeout: 30_000 })
    await expect(this.branchTrigger()).toBeVisible({ timeout: TIMEOUT })
  }

  async expectBranch(branchName: string): Promise<void> {
    await this.waitReady()
    const control = this.branchTrigger()
    await expect.poll(async () => control.getAttribute('data-branch-name'), { timeout: TIMEOUT }).toBe(branchName)
    await expect(control).toContainText(branchName, { timeout: TIMEOUT })
  }

  async openBranchPicker(): Promise<void> {
    await this.waitReady()
    await this.branchTrigger().click()
    await expect(this.picker()).toBeVisible({ timeout: TIMEOUT })
  }

  async expectLocalBranchVisible(branchName: string): Promise<void> {
    const option = this.page
      .locator('[data-testid="git-branch-option"][data-branch-scope="local"]')
      .filter({ hasText: branchName })
      .first()
    await expect(option).toBeVisible({ timeout: TIMEOUT })
  }
}
