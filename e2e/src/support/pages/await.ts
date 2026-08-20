import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 40_000

interface AwaitPageOwner {
  page: Page
  params: { serverUrl: string }
}

export class AwaitPage {
  constructor(private readonly owner: AwaitPageOwner) {}

  private get page(): Page {
    return this.owner.page
  }

  panel(): Locator {
    return this.page.locator('[data-testid="right-aside-await-panel"]')
  }

  card(): Locator {
    return this.panel().locator('[data-testid="javascript-await-card"]')
  }

  async open(): Promise<void> {
    const aside = this.page.locator('[data-testid="right-aside"][data-visible]')
    if (await aside.getAttribute('data-visible') !== 'true') {
      await this.page.locator('[data-testid="app-header-aside-toggle"]').click()
    }
    await expect(aside).toHaveAttribute('data-visible', 'true', { timeout: TIMEOUT })
    const tab = this.page.locator('[data-testid="right-aside-tab-await"]')
    await expect(tab).toBeVisible({ timeout: TIMEOUT })
    await tab.click()
    await expect(this.panel()).toHaveAttribute('data-right-aside-await-ready', 'true', { timeout: TIMEOUT })
  }

  async expectStatus(status: 'pending' | 'triggered', reason?: string): Promise<void> {
    await expect(this.card()).toHaveAttribute('data-status', status, { timeout: TIMEOUT })
    if (reason) {
      await expect(this.card()).toContainText(reason, { timeout: TIMEOUT })
    }
  }

  async register(sessionId: string, reason: string): Promise<string> {
    const sessionResponse = await fetch(`${this.owner.params.serverUrl}/sessions/${sessionId}`)
    if (!sessionResponse.ok) {
      throw new Error(`Failed to read Await session: ${sessionResponse.status}`)
    }
    const session = await sessionResponse.json() as { workspaceId: string | null }
    if (!session.workspaceId) {
      throw new Error(`Session ${sessionId} has no workspace for Await`)
    }

    const response = await fetch(`${this.owner.params.serverUrl}/session-awaits/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatSessionId: sessionId,
        workspaceId: session.workspaceId,
        source: 'javascript',
        filterJson: JSON.stringify({ program: 'export default async () => false' }),
        reason,
      }),
    })
    if (!response.ok) {
      throw new Error(`Failed to register Await: ${response.status} ${await response.text()}`)
    }
    return (await response.json() as { id: string }).id
  }

  async trigger(awaitId: string, resumeText: string): Promise<void> {
    const response = await fetch(`${this.owner.params.serverUrl}/session-awaits/${awaitId}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeText }),
    })
    if (!response.ok) {
      throw new Error(`Failed to trigger Await: ${response.status} ${await response.text()}`)
    }
  }

  async expectServerStatus(awaitId: string, status: string): Promise<void> {
    await expect.poll(async () => {
      const response = await fetch(`${this.owner.params.serverUrl}/session-awaits/${awaitId}`)
      if (!response.ok) {
        return null
      }
      return (await response.json() as { status: string }).status
    }, { timeout: TIMEOUT }).toBe(status)
  }
}
