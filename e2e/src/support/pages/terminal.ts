import { createHash } from 'node:crypto'

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 30_000
const WHITESPACE_DOTS_RE = /[·\s]+/g

export class TerminalPage {
  constructor(private readonly page: Page) {}

  bottomPanel() {
    return this.page.locator('[data-testid="app-layout-bottom-panel"]')
  }

  shellView() {
    return this.page.locator('[data-testid="shell-view"]')
  }

  async open(): Promise<void> {
    const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
    const panel = this.bottomPanel()
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    if ((await panel.getAttribute('data-panel-open')) !== 'true') {
      await toggle.click()
    }
    await expect(panel).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
  }

  async expectVisible(): Promise<void> {
    await expect(this.bottomPanel()).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
    await expect(this.shellView()).toBeVisible({ timeout: TIMEOUT })
  }

  async waitReady(): Promise<void> {
    const shellView = this.shellView()
    const textArea = shellView.locator('textarea.xterm-helper-textarea')
    await expect(shellView).toBeVisible({ timeout: TIMEOUT })
    await expect(shellView).toHaveAttribute('data-shell-ready', 'true', { timeout: TIMEOUT })
    await expect(textArea).toBeAttached({ timeout: TIMEOUT })
  }

  async runCommand(command: string): Promise<void> {
    await this.waitReady()
    const textArea = this.shellView().locator('textarea.xterm-helper-textarea')
    await textArea.focus()
    await this.page.keyboard.type(command)
    await this.page.keyboard.press('Enter')
  }

  async readTranscript(): Promise<string> {
    return (await this.page.locator('[data-testid="shell-view-transcript"]').textContent()) ?? ''
  }

  async expectWorkspacePathHash(workspacePath: string): Promise<void> {
    // `pwd` prints a trailing newline before piping to shasum.
    const expected = createHash('sha1').update(`${workspacePath}\n`).digest('hex')
    await expect.poll(async () => {
      const text = (await this.readTranscript()).replace(WHITESPACE_DOTS_RE, '')
      return text.includes(expected)
    }, { timeout: TIMEOUT }).toBe(true)
  }

  async close(): Promise<void> {
    const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
    const panel = this.bottomPanel()
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    if ((await panel.getAttribute('data-panel-open')) !== 'false') {
      await toggle.click()
    }
    await expect(panel).toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
  }

  async expectClosed(): Promise<void> {
    await expect(this.bottomPanel()).toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
  }
}
