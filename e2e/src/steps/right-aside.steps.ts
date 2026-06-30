import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const ASIDE_TIMEOUT = 30_000
const RIGHT_ASIDE = '[data-testid="app-layout-right-aside"]'
const RIGHT_ASIDE_TOGGLE = '[data-testid="app-header-aside-toggle"]'
const RIGHT_ASIDE_ROOT = '[data-testid="right-aside"]'

const ASIDE_TAB_LABEL_TO_ID: Record<string, string> = {
  Changes: 'changes',
  Feed: 'await',
  Issue: 'issue',
  Git: 'git',
  文件: 'files',
}

function asideTabId(label: string): string {
  const id = ASIDE_TAB_LABEL_TO_ID[label]
  if (!id) {
    throw new Error(`Unknown right aside tab label: ${label}`)
  }
  return id
}

async function openRightAside(world: CradleWorld): Promise<void> {
  const aside = world.page.locator(RIGHT_ASIDE)
  await expect(aside).toHaveCount(1, { timeout: ASIDE_TIMEOUT })

  if (await aside.getAttribute('data-aside-open') !== 'true') {
    const toggle = world.page.locator(RIGHT_ASIDE_TOGGLE)
    await expect(toggle).toBeVisible({ timeout: ASIDE_TIMEOUT })
    await toggle.click()
  }

  await expect(aside).toHaveAttribute('data-aside-open', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(world.page.locator(RIGHT_ASIDE_ROOT)).toBeVisible({ timeout: ASIDE_TIMEOUT })
}

When('我打开右侧 aside', async function (this: CradleWorld) {
  console.warn('[step] open right aside')
  await openRightAside(this)
})

When('我切换右侧 aside 到{string}标签', async function (this: CradleWorld, label: string) {
  const id = asideTabId(label)
  console.warn(`[step] switch right aside tab: ${label}`)

  await openRightAside(this)

  const tab = this.page.locator(`[data-testid="right-aside-tab-${id}"]`)
  await expect(tab).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await tab.click()

  await expect(tab).toHaveAttribute('data-active', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(this.page.locator(RIGHT_ASIDE_ROOT)).toHaveAttribute('data-active-tab', id, { timeout: ASIDE_TIMEOUT })
})

Then('右侧 Issue 面板应显示未关联状态', async function (this: CradleWorld) {
  console.warn('[step] assert right aside issue empty state')
  const panel = this.page.locator('[data-testid="right-aside-issue-panel"]')

  await expect(panel).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(panel).toHaveAttribute('data-right-aside-issue-ready', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(panel).toContainText('No linked issue', { timeout: ASIDE_TIMEOUT })
  await expect(panel.getByRole('button', { name: 'Link issue' })).toBeVisible({ timeout: ASIDE_TIMEOUT })
})

When('我在右侧 Issue 面板关联 Issue{string}', async function (this: CradleWorld, title: string) {
  console.warn(`[step] link issue from right aside: ${title}`)
  const panel = this.page.locator('[data-testid="right-aside-issue-panel"]')

  await expect(panel).toHaveAttribute('data-right-aside-issue-ready', 'true', { timeout: ASIDE_TIMEOUT })
  await panel.getByRole('button', { name: 'Link issue' }).click()

  const input = this.page.getByLabel('Search issues')
  await expect(input).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await input.fill(title)

  const option = this.page.locator('[data-slot="combobox-item"]').filter({ hasText: title }).first()
  await expect(option).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await option.click()
})

Then('右侧 Issue 面板应显示 Issue{string}', async function (this: CradleWorld, title: string) {
  console.warn(`[step] assert right aside linked issue: ${title}`)
  const panel = this.page.locator('[data-testid="right-aside-issue-panel"]')

  await expect(panel).toHaveAttribute('data-right-aside-issue-ready', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(panel).toContainText(title, { timeout: ASIDE_TIMEOUT })
  await expect(panel.getByRole('button', { name: 'Open issue in Kanban' })).toBeEnabled({ timeout: ASIDE_TIMEOUT })
})

When('我从右侧 Issue 面板打开当前 Issue', async function (this: CradleWorld) {
  console.warn('[step] open linked issue from right aside')
  const panel = this.page.locator('[data-testid="right-aside-issue-panel"]')
  const button = panel.getByRole('button', { name: 'Open issue in Kanban' })

  await expect(button).toBeEnabled({ timeout: ASIDE_TIMEOUT })
  await button.click()
})

Then('右侧 Feed 面板应显示 GitHub checks composer', async function (this: CradleWorld) {
  console.warn('[step] assert right aside feed checks composer')
  const panel = this.page.locator('[data-testid="right-aside-await-panel"]')

  await expect(panel).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(panel).toHaveAttribute('data-right-aside-await-ready', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(panel.locator('[data-testid="github-await-composer"]')).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(panel.getByLabel('GitHub repository')).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(panel.getByLabel('GitHub pull request number, commit SHA/ref, or check run URL')).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(panel.getByRole('button', { name: 'Wait for checks' })).toBeDisabled({ timeout: ASIDE_TIMEOUT })
})

When('我将右侧 Feed composer 切换为 review', async function (this: CradleWorld) {
  console.warn('[step] switch right aside feed composer to review')
  const panel = this.page.locator('[data-testid="right-aside-await-panel"]')
  const reviewButton = panel.getByRole('radio', { name: 'GitHub review' })

  await expect(reviewButton).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await reviewButton.click()
})

Then('右侧 Feed composer 应显示 review 模式', async function (this: CradleWorld) {
  console.warn('[step] assert right aside feed review mode')
  const panel = this.page.locator('[data-testid="right-aside-await-panel"]')

  await expect(panel.getByLabel('GitHub pull request number')).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(panel.getByRole('button', { name: 'Wait for review' })).toBeDisabled({ timeout: ASIDE_TIMEOUT })
})

When('我在右侧 Files 面板搜索{string}', async function (this: CradleWorld, query: string) {
  console.warn(`[step] search right aside files: ${query}`)
  const panel = this.page.locator('[data-testid="right-aside-panel-files"]')
  const tree = panel.locator('[data-testid="right-aside-file-tree"]')

  await expect(tree).toHaveAttribute('data-right-aside-files-ready', 'true', { timeout: ASIDE_TIMEOUT })
  const searchInput = panel.getByLabel('Search files')
  await expect(searchInput).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await searchInput.fill(query)
})

Then('右侧 Files 面板应可用', async function (this: CradleWorld) {
  console.warn('[step] assert right aside files panel ready')
  const panel = this.page.locator('[data-testid="right-aside-panel-files"]')
  const tree = panel.locator('[data-testid="right-aside-file-tree"]')

  await expect(panel).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(tree).toHaveAttribute('data-right-aside-files-ready', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(panel.getByLabel('Search files')).toBeVisible({ timeout: ASIDE_TIMEOUT })
})

Then('右侧 Files 面板应显示 {int} 个搜索结果', async function (this: CradleWorld, count: number) {
  console.warn(`[step] assert right aside file search count: ${count}`)
  const panel = this.page.locator('[data-testid="right-aside-panel-files"]')
  const tree = panel.locator('[data-testid="right-aside-file-tree"]')

  await expect(panel).toBeVisible({ timeout: ASIDE_TIMEOUT })
  await expect(tree).toHaveAttribute('data-right-aside-files-ready', 'true', { timeout: ASIDE_TIMEOUT })
  await expect(panel.locator('[data-testid="right-aside-file-search-count"]')).toHaveText(String(count), { timeout: ASIDE_TIMEOUT })
})
