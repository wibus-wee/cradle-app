import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 15_000

export class StoragePage {
  constructor(private readonly page: Page) {}

  manager(): Locator {
    return this.page.locator('[data-testid="storage-manager"]')
  }

  session(sessionId: string): Locator {
    return this.manager().locator(`[data-testid="storage-session-${sessionId}"]`)
  }

  async expectVisible(): Promise<void> {
    await expect(this.manager()).toBeVisible({ timeout: TIMEOUT })
  }

  async expectSession(sessionId: string, messageCount: number): Promise<void> {
    const row = this.session(sessionId)
    await expect(row).toBeVisible({ timeout: TIMEOUT })
    await expect(row).toContainText(`${messageCount} message`, { timeout: TIMEOUT })
  }

  async expectActiveProtected(sessionId: string): Promise<void> {
    const row = this.session(sessionId)
    await expect(row).toContainText('Active', { timeout: TIMEOUT })
    await expect(row.getByRole('checkbox')).toBeDisabled()
    await expect(row.getByRole('button', { name: 'Clear transcript' })).toBeDisabled()
    await expect(row.getByRole('button', { name: 'Delete session' })).toBeDisabled()
  }

  async clearTranscript(sessionId: string): Promise<void> {
    const row = this.session(sessionId)
    await row.hover()
    await row.getByRole('button', { name: 'Clear transcript' }).click()
    await this.page.getByRole('button', { name: 'Clear transcripts', exact: true }).click()
    await expect(this.page.getByText('Storage cleanup complete')).toBeVisible({ timeout: TIMEOUT })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const row = this.session(sessionId)
    await row.hover()
    await row.getByRole('button', { name: 'Delete session' }).click()
    await this.page.getByRole('button', { name: 'Delete sessions', exact: true }).click()
    await expect(this.session(sessionId)).toHaveCount(0, { timeout: TIMEOUT })
  }
}
