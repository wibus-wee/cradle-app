import { createHash } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000
const WHITESPACE_DOTS_RE = /[·\s]+/g

export class TerminalPage {
  constructor(private readonly page: Page) {}

  bottomPanel() {
    return this.page.locator('[data-testid="bottom-terminal-panel"], [data-testid="app-layout-bottom-panel"]')
  }

  /**
   * Only the visible/active shell — multiple PTYs stay mounted with
   * data-shell-visible=false. Targeting the generic shell-view locator
   * focuses the wrong xterm helper textarea (classic multi-PTY input-ref bug).
   */
  activeShellView(): Locator {
    return this.page.locator('[data-testid="shell-view"][data-shell-visible="true"]')
  }

  shellView() {
    return this.activeShellView()
  }

  async open(): Promise<void> {
    const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
    const panel = this.page.locator('[data-testid="app-layout-bottom-panel"]')
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    if ((await panel.getAttribute('data-panel-open')) !== 'true') {
      await toggle.click()
    }
    await expect(panel).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
  }

  async expectVisible(): Promise<void> {
    await expect(this.page.locator('[data-testid="app-layout-bottom-panel"]'))
      .toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
    await expect(this.activeShellView()).toBeVisible({ timeout: TIMEOUT })
  }

  async waitReady(): Promise<void> {
    const shellView = this.activeShellView()
    const textArea = shellView.locator('textarea.xterm-helper-textarea')
    await expect(shellView).toBeVisible({ timeout: TIMEOUT })
    await expect(shellView).toHaveAttribute('data-shell-ready', 'true', { timeout: TIMEOUT })
    await expect(textArea).toBeAttached({ timeout: TIMEOUT })
  }

  async runCommand(command: string): Promise<void> {
    await this.waitReady()
    const shellView = this.activeShellView()
    const textArea = shellView.locator('textarea.xterm-helper-textarea')
    // Strict: exactly one visible PTY must own stdin.
    await expect(this.page.locator('[data-testid="shell-view"][data-shell-visible="true"]')).toHaveCount(1)
    await shellView.click({ position: { x: 12, y: 12 } })
    await expect(textArea).toBeFocused({ timeout: TIMEOUT })
    await this.page.keyboard.type(command)
    await this.page.keyboard.press('Enter')
  }

  async readTranscript(): Promise<string> {
    return (await this.activeShellView().locator('[data-testid="shell-view-transcript"]').textContent()) ?? ''
  }

  async expectTranscriptContains(text: string): Promise<void> {
    const needle = text.replace(WHITESPACE_DOTS_RE, '')
    await expect.poll(async () => {
      return (await this.readTranscript()).replace(WHITESPACE_DOTS_RE, '')
    }, { timeout: TIMEOUT }).toContain(needle)
  }

  async expectTranscriptNotContains(text: string): Promise<void> {
    const needle = text.replace(WHITESPACE_DOTS_RE, '')
    await expect.poll(async () => {
      return (await this.readTranscript()).replace(WHITESPACE_DOTS_RE, '')
    }, { timeout: TIMEOUT }).not.toContain(needle)
  }

  async expectWorkspacePathHash(workspacePath: string): Promise<void> {
    // `pwd` prints a trailing newline before piping to shasum.
    const expected = createHash('sha1').update(`${workspacePath}\n`).digest('hex')
    await this.expectTranscriptContains(expected)
  }

  async close(): Promise<void> {
    const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
    const panel = this.page.locator('[data-testid="app-layout-bottom-panel"]')
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    if ((await panel.getAttribute('data-panel-open')) !== 'false') {
      await toggle.click()
    }
    await expect(panel).toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
  }

  async expectClosed(): Promise<void> {
    await expect(this.page.locator('[data-testid="app-layout-bottom-panel"]'))
      .toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
  }

  sessionTabs(): Locator {
    return this.page.locator('[data-testid="bottom-terminal-tab"]')
  }

  async createSession(): Promise<void> {
    const before = await this.sessionTabs().count()
    const button = this.page.locator('[data-testid="bottom-terminal-new-session"]')
    await expect(button).toBeVisible({ timeout: TIMEOUT })
    await button.click()
    await expect(this.sessionTabs()).toHaveCount(before + 1, { timeout: TIMEOUT })
    await this.waitReady()
  }

  async activateSession(ordinal: number): Promise<void> {
    const tab = this.sessionTabs().nth(ordinal - 1)
    await expect(tab).toBeVisible({ timeout: TIMEOUT })
    await tab.locator('button').first().click()
    await expect(tab).toHaveAttribute('data-active', 'true', { timeout: TIMEOUT })
    await this.waitReady()
  }
}
