import type { Locator, Page, Route } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000
const NOTES_ROUTE = '**/sessions/*/environment/notes'

export interface DelayedNotesSave {
  waitUntilBlocked: () => Promise<void>
  release: () => void
  waitUntilCompleted: () => Promise<void>
  dispose: () => Promise<void>
}

export class SessionEnvironmentPage {
  constructor(private readonly page: Page) {}

  panel(): Locator {
    return this.page.locator('[data-testid="right-aside-panel-environment"]')
  }

  editor(): Locator {
    return this.panel().locator('[data-testid="session-notes-editor"]')
  }

  status(): Locator {
    return this.panel().locator('[data-testid="session-notes-status"]')
  }

  async open(): Promise<void> {
    const aside = this.page.locator('[data-testid="right-aside"][data-visible]')
    if (await aside.getAttribute('data-visible') !== 'true') {
      await this.page.locator('[data-testid="app-header-aside-toggle"]').click()
    }
    await expect(aside).toHaveAttribute('data-visible', 'true', { timeout: TIMEOUT })

    const tab = this.page.locator('[data-testid="right-aside-tab-environment"]')
    await expect(tab).toBeVisible({ timeout: TIMEOUT })
    await tab.click()
    await expect(tab).toHaveAttribute('data-active', 'true', { timeout: TIMEOUT })
    await expect(this.editor()).toBeVisible({ timeout: TIMEOUT })
  }

  async fillNotes(notes: string): Promise<void> {
    await this.editor().fill(notes)
  }

  async expectDraft(notes: string): Promise<void> {
    await expect(this.editor()).toHaveValue(notes, { timeout: TIMEOUT })
  }

  async expectStatus(status: 'saved' | 'unsaved' | 'saving' | 'error'): Promise<void> {
    await expect(this.status()).toHaveAttribute('data-status', status, { timeout: TIMEOUT })
  }

  async delayNextNotesSave(): Promise<DelayedNotesSave> {
    let releaseRequest!: () => void
    let markBlocked!: () => void
    let markCompleted!: () => void
    let delayed = false

    const releasePromise = new Promise<void>((resolve) => { releaseRequest = resolve })
    const blockedPromise = new Promise<void>((resolve) => { markBlocked = resolve })
    const completedPromise = new Promise<void>((resolve) => { markCompleted = resolve })

    const handler = async (route: Route) => {
      if (delayed || route.request().method() !== 'PUT') {
        await route.continue()
        return
      }

      delayed = true
      markBlocked()
      await releasePromise
      const response = await route.fetch()
      await route.fulfill({ response })
      markCompleted()
    }

    await this.page.route(NOTES_ROUTE, handler)

    return {
      waitUntilBlocked: () => blockedPromise,
      release: releaseRequest,
      waitUntilCompleted: () => completedPromise,
      dispose: () => this.page.unroute(NOTES_ROUTE, handler),
    }
  }
}
