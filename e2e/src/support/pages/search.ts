import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 15_000

const COMMAND_LABEL_TO_ID: Record<string, string> = {
  '打开设置': 'open-settings',
  'Open settings': 'open-settings',
  '用量统计': 'open-usage',
  'Usage': 'open-usage',
  '切换侧栏': 'toggle-sidebar',
  'Toggle sidebar': 'toggle-sidebar',
  '新建对话': 'new-chat',
  'New chat': 'new-chat',
}

export class SearchPage {
  constructor(private readonly page: Page) {}

  dialog(): Locator {
    return this.page.locator('[data-testid="global-search-dialog"]')
  }

  input(): Locator {
    return this.page.locator('[data-testid="global-search-input"]').filter({ visible: true }).last()
  }

  async open(): Promise<void> {
    if (await this.dialog().isVisible().catch(() => false)) {
      return
    }
    const searchButton = this.page.getByTestId('nav-search')
    await expect(searchButton).toBeVisible({ timeout: TIMEOUT })
    await searchButton.click()
    if (!(await this.dialog().isVisible().catch(() => false))) {
      await this.page.keyboard.press('Control+P')
    }
    if (!(await this.dialog().isVisible().catch(() => false))) {
      await this.page.keyboard.press('Control+K')
    }
    await expect(this.dialog()).toBeVisible({ timeout: TIMEOUT })
    await expect(this.input()).toBeVisible({ timeout: TIMEOUT })
  }

  async fill(query: string): Promise<void> {
    const input = this.input()
    await expect(input).toBeVisible({ timeout: TIMEOUT })
    await input.fill(query)
  }

  issueResult(title: string): Locator {
    return this.page.getByTestId(`global-search-issue-result-${title}`)
      .filter({ visible: true })
      .last()
  }

  async fillIssueQuery(query: string): Promise<void> {
    const responsePromise = this.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname === '/issues/search'
        && url.searchParams.get('q') === query
    })
    await this.fill(`#${query}`)
    const response = await responsePromise
    expect(response.ok()).toBe(true)
  }

  async expectIssueVisible(title: string): Promise<void> {
    await expect(this.issueResult(title)).toBeVisible({ timeout: TIMEOUT })
  }

  async expectIssueHidden(title: string): Promise<void> {
    await expect(this.issueResult(title)).toHaveCount(0, { timeout: TIMEOUT })
  }

  async expectNoMatchingResults(): Promise<void> {
    await expect(this.dialog().getByText('No matching results found', { exact: true }))
      .toBeVisible({ timeout: TIMEOUT })
  }

  async openIssue(title: string): Promise<void> {
    const result = this.issueResult(title)
    await expect(result).toBeVisible({ timeout: TIMEOUT })
    await result.click()
    await expect(this.input()).toBeHidden({ timeout: TIMEOUT })
  }

  commandRow(label: string): Locator {
    const id = COMMAND_LABEL_TO_ID[label]
    if (!id) {
      throw new Error(`Unknown global search command label: ${label}`)
    }
    return this.page.locator(`[data-testid="global-search-command-${id}"]`).filter({ visible: true }).last()
  }

  async expectCommandVisible(label: string): Promise<void> {
    const row = this.commandRow(label)
    await expect(row).toBeVisible({ timeout: TIMEOUT })
    await expect(row).toContainText(label, { timeout: TIMEOUT })
  }

  async runCommand(label: string): Promise<void> {
    const row = this.commandRow(label)
    await expect(row).toBeVisible({ timeout: TIMEOUT })
    await row.click()
    await expect(this.input()).toBeHidden({ timeout: TIMEOUT })
  }

  threadResult(sessionId: string): Locator {
    return this.page.locator(`[data-testid="global-search-thread-result-${sessionId}"]`)
      .filter({ visible: true })
      .last()
  }

  async expectThreadTitleHighlight(sessionId: string, query: string): Promise<void> {
    const result = this.threadResult(sessionId)
    await expect(result).toBeVisible({ timeout: TIMEOUT })
    const mark = result.locator('mark').filter({ hasText: query }).first()
    if (await mark.count() > 0) {
      await expect(mark).toBeVisible({ timeout: TIMEOUT })
      return
    }
    await expect(result).toContainText(query, { timeout: TIMEOUT })
  }

  async openThread(sessionId: string): Promise<void> {
    const result = this.threadResult(sessionId)
    await expect(result).toBeVisible({ timeout: TIMEOUT })
    await result.click()
    await expect(this.input()).toBeHidden({ timeout: TIMEOUT })
  }
}
