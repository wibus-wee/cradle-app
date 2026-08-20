import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000

export class FirstRunPage {
  constructor(private readonly page: Page) {}

  onboarding(): Locator {
    return this.page.locator('[data-testid="onboarding-page"]')
  }

  setupDialog(): Locator {
    return this.page.locator('[data-testid="first-run-setup-dialog"]')
  }

  async completeBrandOnboarding(): Promise<void> {
    await expect(this.onboarding()).toBeVisible({ timeout: TIMEOUT })
    await this.onboarding().click()
    await expect(this.onboarding()).toHaveCount(0, { timeout: TIMEOUT })
  }

  async waitForSetupStep(step: 'provider' | 'github' | 'done'): Promise<void> {
    await expect(this.setupDialog()).toBeVisible({ timeout: TIMEOUT })
    await expect(this.setupDialog()).toHaveAttribute('data-setup-step', step, { timeout: TIMEOUT })
  }

  async createAnthropicProvider(input: {
    name: string
    baseUrl: string
    apiKey: string
  }): Promise<void> {
    await this.waitForSetupStep('provider')
    await this.page.locator('[data-testid="provider-preset-anthropic"]').click()

    const name = this.page.locator('[data-testid="provider-name"]')
    const baseUrl = this.page.locator('[data-testid="provider-baseurl"], [data-testid="provider-anthropic-baseurl"]').first()
    const apiKey = this.page.locator('[data-testid="provider-apikey"]')
    await expect(name).toBeVisible({ timeout: TIMEOUT })
    await name.fill(input.name)
    await baseUrl.fill(input.baseUrl)
    await apiKey.fill(input.apiKey)

    const submit = this.page.locator('[data-testid="provider-submit"]')
    await expect(submit).toBeEnabled({ timeout: TIMEOUT })
    await submit.click()
    const status = this.page.locator('[data-testid="provider-status"]')
    await expect(status).toHaveAttribute('data-status-ok', 'true', { timeout: TIMEOUT })
    await this.waitForSetupStep('github')
  }

  async skipGithubAndFinish(): Promise<void> {
    await this.waitForSetupStep('github')
    await this.page.locator('[data-testid="first-run-github-continue"]').click()
    await this.waitForSetupStep('done')
    await this.page.locator('[data-testid="first-run-finish"]').click()
    await expect(this.setupDialog()).toHaveCount(0, { timeout: TIMEOUT })
  }
}
