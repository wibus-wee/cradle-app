import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../world'

const EDITOR_TIMEOUT = 20_000

export class WorkspaceEditorPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  private browserPanel(): Locator {
    return this.page.locator('[data-testid="browser-panel"]:visible').first()
  }

  private fileTree(): Locator {
    return this.page.locator('[data-testid="right-aside-file-tree"]:visible').first()
  }

  private editor(): Locator {
    return this.browserPanel().locator('.monaco-editor')
  }

  private editorStatus(): Locator {
    return this.browserPanel().locator('p').filter({ hasText: /^(?:Saved|Unsaved changes|Saving)$/ })
  }

  private fileTreeItem(relativePath: string): Locator {
    return this.fileTree().locator(`[data-item-path=${JSON.stringify(relativePath)}]`)
  }

  async openFile(relativePath: string): Promise<void> {
    const aside = this.page.locator('[data-testid="right-aside"]:visible').first()
    if (!(await aside.isVisible().catch(() => false))) {
      const toggle = this.page.locator('[data-testid="app-header-aside-toggle"]')
      await expect(toggle).toBeVisible({ timeout: EDITOR_TIMEOUT })
      await toggle.click()
    }

    await expect(aside).toBeVisible({ timeout: EDITOR_TIMEOUT })
    const filesTab = aside.locator('[data-testid="right-aside-tab-files"]')
    await expect(filesTab).toBeVisible({ timeout: EDITOR_TIMEOUT })
    if (await filesTab.getAttribute('data-active') !== 'true') {
      await filesTab.click()
    }

    await expect(this.fileTree()).toHaveAttribute('data-right-aside-files-ready', 'true', {
      timeout: EDITOR_TIMEOUT,
    })
    const item = this.fileTreeItem(relativePath)
    await expect(item).toBeVisible({ timeout: EDITOR_TIMEOUT })
    await item.dblclick()

    await this.expectFileOpen(relativePath)
  }

  async expectFileOpen(relativePath: string): Promise<void> {
    const panel = this.browserPanel()
    await expect(panel).toBeVisible({ timeout: EDITOR_TIMEOUT })
    await expect(panel.getByRole('button', { name: basename(relativePath), exact: true }))
      .toHaveAttribute('aria-current', 'page', { timeout: EDITOR_TIMEOUT })
    await expect(this.editor()).toBeVisible({ timeout: EDITOR_TIMEOUT })
  }

  async expectContent(content: string): Promise<void> {
    await expect(this.editor().locator('.view-lines')).toContainText(content, { timeout: EDITOR_TIMEOUT })
  }

  async expectStatus(status: string): Promise<void> {
    await expect(this.editorStatus()).toHaveText(status, { timeout: EDITOR_TIMEOUT })
  }

  async replaceContent(content: string): Promise<void> {
    const editor = this.editor()
    await expect(editor).toBeVisible({ timeout: EDITOR_TIMEOUT })
    await editor.click()
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await this.page.keyboard.type(content)
    await this.expectContent(content)
  }

  async save(relativePath: string): Promise<void> {
    const saveButton = this.browserPanel().getByRole('button', { name: 'Save file', exact: true })
    await expect(saveButton).toBeEnabled({ timeout: EDITOR_TIMEOUT })

    const responsePromise = this.page.waitForResponse((response) => {
      if (response.request().method() !== 'PUT') {
        return false
      }
      const url = new URL(response.url())
      return url.pathname.endsWith('/files/content')
        && response.request().postDataJSON()?.path === relativePath
    })
    await saveButton.click()
    const response = await responsePromise
    expect(response.ok()).toBe(true)
  }

  expectDiskContent(relativePath: string, content: string): void {
    const workspace = this.world.workspacePage.recallCurrentWorkspace()
    expect(readFileSync(join(workspace.dir, relativePath), 'utf8')).toBe(content)
  }
}
