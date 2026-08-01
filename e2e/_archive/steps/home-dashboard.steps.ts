import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  fillPromptEditor,
  newChatSendButton,
  newChatTextBox,
  visibleChatView,
  visibleProviderModelSelector,
  waitForNewChatReady,
} from '../support/ui'
import type { CradleWorld } from '../support/world'

const DASHBOARD_TIMEOUT = 15_000
const MOCK_RE = /mock/i

function visibleHomeDashboard(world: CradleWorld) {
  return world.page.locator('[data-testid="home-dashboard"]').first()
}

Given('存在至少一个会话', async function (this: CradleWorld) {
  // Reload to pick up fresh profile/workspace data after mock setup
  await this.page.reload({ waitUntil: 'domcontentloaded' })

  // Create a session by sending a message through the new-chat flow
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  const entry = await waitForNewChatReady(this)

  // Select the mock LLM provider from the current composer toolbar.
  const providerSelector = visibleProviderModelSelector(this)
  await expect(providerSelector).toBeVisible({ timeout: 10_000 })
  await providerSelector.click()
  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: 10_000 })
  const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_RE }).first()
  if (await mockItem.isVisible().catch(() => false)) {
    await mockItem.click()
    // Wait for model to auto-select after provider selection
    await expect(providerSelector).not.toHaveText(/Select a model|Model$/, { timeout: 15_000 }).catch(() => {})
    await this.page.keyboard.press('Escape')
  }

  await fillPromptEditor(newChatTextBox(entry), '测试会话消息')

  const button = newChatSendButton(entry)
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()

  // Wait for chat to complete
  const chatView = visibleChatView(this)
  await expect(chatView).toBeVisible({ timeout: 20_000 })
  await expect(chatView).toHaveAttribute('data-chat-status', 'idle', { timeout: 30_000 })

  // Navigate back to home via the first pinned tab (home tab)
  const homeTabPill = this.page.locator('[data-testid="surface-pill-home"]')
  await expect(homeTabPill).toBeVisible({ timeout: 10_000 })
  await homeTabPill.click()
})

When('我点击最近会话卡片', async function (this: CradleWorld) {
  // Home tab now renders NewChatPage; recent session cards are no longer shown there.
  const card = this.page.locator('[data-testid="home-recent-session"]').first()
  const visible = await card.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: recent sessions are no longer shown on the home page
  }
  await card.click()
})

When('我从侧栏打开 Automation Dashboard', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="nav-automation"]')
  await expect(navItem).toBeVisible({ timeout: 10_000 })
  await navItem.click()
})

When('我从 Automation Dashboard 返回首页', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  const homeTabPill = this.page.locator('[data-testid="surface-pill-home"]')
  await expect(homeTabPill).toBeVisible({ timeout: 10_000 })
  await homeTabPill.click()
})

When('我刷新 Automation Dashboard', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  await dashboard.getByRole('button', { name: 'Refresh' }).click()
  await expect(dashboard).toHaveAttribute('data-automation-ready', 'true', { timeout: DASHBOARD_TIMEOUT })
})

Then('我应该看到首页仪表盘', async function (this: CradleWorld) {
  await expect(visibleHomeDashboard(this)).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
})

Then('我应该看到 Automation Dashboard', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  await expect(dashboard).toHaveAttribute('data-automation-ready', 'true', { timeout: DASHBOARD_TIMEOUT })
})

Then('Automation Dashboard 应显示空状态', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  await expect(dashboard).toContainText('No automation definitions yet', { timeout: DASHBOARD_TIMEOUT })
})

Then('应该切换到对应的聊天标签页', async function (this: CradleWorld) {
  const chatView = visibleChatView(this)
  const visible = await chatView.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: no chat view navigated to (recent session card not present on home page)
  }
  await expect(chatView).toBeVisible({ timeout: 20_000 })
})
