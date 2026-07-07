import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const SETTINGS_TIMEOUT = 10_000

const SETTINGS_NAV_IDS: Record<string, string> = {
  Appearance: 'appearance',
  Jarvis: 'jarvis',
  Desktop: 'desktop',
  Support: 'support',
  外观: 'appearance',
  记录: 'chronicle',
  桌面端: 'desktop',
  支持: 'support',
}

const THEME_LABEL_TO_ID: Record<string, string> = {
  浅色: 'light',
  深色: 'dark',
  自动: 'system',
}

function settingNavId(label: string): string {
  const id = SETTINGS_NAV_IDS[label]
  if (!id) {
    throw new Error(`Unknown settings nav label: ${label}`)
  }
  return id
}

function themeId(label: string): string {
  const id = THEME_LABEL_TO_ID[label]
  if (!id) {
    throw new Error(`Unknown theme label: ${label}`)
  }
  return id
}

When('我点击{string}设置导航项', async function (this: CradleWorld, label: string) {
  const navItem = this.page.locator(`[data-testid="settings-nav-${settingNavId(label)}"]`)
  await expect(navItem).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await navItem.click()
})

When('我关闭设置并返回首页', async function (this: CradleWorld) {
  await this.page.keyboard.press('Escape')
  await expect(this.page.locator('[role="menu"]').last()).toBeHidden({ timeout: SETTINGS_TIMEOUT }).catch(() => undefined)

  const closeButton = this.page.locator('[data-testid="settings-close"]')
  await expect(closeButton).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await closeButton.click()

  const homeSurface = this.page.locator('[data-testid="surface-pill-home"]')
  await expect(homeSurface).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await homeSurface.click()
})

When('我复制 Support 反馈模板', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="support-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await settings.getByRole('button', { name: 'Copy' }).click()
})

When('我选择外观主题{string}', async function (this: CradleWorld, label: string) {
  const option = this.page.locator(`[data-testid="appearance-theme-${themeId(label)}"]`)
  await expect(option).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await option.click()
})

Then('我应该看到 Support 设置页面', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="support-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(settings).toHaveAttribute('data-settings-support-ready', 'true', { timeout: SETTINGS_TIMEOUT })
})

Then('我应该看到 Appearance 设置页面', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="appearance-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(settings).toHaveAttribute('data-settings-appearance-ready', 'true', { timeout: SETTINGS_TIMEOUT })
})

Then('我应该看到 Desktop Updates 设置页面', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="desktop-update-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(settings).toHaveAttribute('data-settings-desktop-ready', 'true', { timeout: SETTINGS_TIMEOUT })
})

Then('Desktop Updates 应显示当前环境不支持更新', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="desktop-update-settings"]')
  await expect(settings).toContainText('Unavailable', { timeout: SETTINGS_TIMEOUT })
  await expect(settings).toContainText('Desktop updates are only available in the Electron app', { timeout: SETTINGS_TIMEOUT })
  await expect(settings).toContainText('0.0.0', { timeout: SETTINGS_TIMEOUT })
  await expect(settings).toContainText('None', { timeout: SETTINGS_TIMEOUT })
})

Then('Desktop Updates 操作按钮应不可用', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="desktop-update-settings"]')
  for (const label of ['Refresh', 'Check', 'Download', 'Restart']) {
    await expect(settings.getByRole('button', { name: label })).toBeDisabled({ timeout: SETTINGS_TIMEOUT })
  }
})

Then('我应该看到 Jarvis 设置页面', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="jarvis-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(settings).toHaveAttribute('data-settings-jarvis-ready', 'true', { timeout: SETTINGS_TIMEOUT })
})

Then('我应该看到 Chronicle 设置页面', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="chronicle-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(settings).toHaveAttribute('data-settings-chronicle-ready', 'true', { timeout: SETTINGS_TIMEOUT })
})

Then('Jarvis 模型选择器应显示空 Provider 状态', async function (this: CradleWorld) {
  const selector = this.page.locator('[data-testid="jarvis-provider-model-selector"]')
  await expect(selector).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(selector).toContainText('Select a model', { timeout: SETTINGS_TIMEOUT })
  await selector.click()

  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(menuPopup).toContainText('No agent profiles configured', { timeout: SETTINGS_TIMEOUT })
})

Then('Chronicle 设置应提示需要配置模型服务', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="chronicle-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(settings).toContainText('Chronicle cannot be enabled yet', { timeout: SETTINGS_TIMEOUT })
  await expect(settings).toContainText('No model provider is configured yet', { timeout: SETTINGS_TIMEOUT })
  await expect(settings.getByRole('button', { name: 'Configure model providers' })).toBeVisible({ timeout: SETTINGS_TIMEOUT })
})

Then('Chronicle 整理模型选择器应显示空 Provider 状态', async function (this: CradleWorld) {
  const selector = this.page.locator('[data-testid="chronicle-provider-model-selector"]')
  await expect(selector).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await selector.click()

  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await expect(menuPopup).toContainText('No model providers configured', { timeout: SETTINGS_TIMEOUT })
  await this.page.keyboard.press('Escape')
})

Then('Chronicle 记录活动开关应不可用', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="chronicle-settings"]')
  await expect(settings).toContainText('Choose an organization model first', { timeout: SETTINGS_TIMEOUT })
  await expect(settings.getByRole('switch').first()).toBeDisabled({ timeout: SETTINGS_TIMEOUT })
})

When('我从 Chronicle 设置跳转配置模型服务', async function (this: CradleWorld) {
  const settings = this.page.locator('[data-testid="chronicle-settings"]')
  await expect(settings).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await settings.getByRole('button', { name: 'Configure model providers' }).click()
})

When('我在 Jarvis 模型选择器选择 Provider {string}', async function (this: CradleWorld, name: string) {
  const selector = this.page.locator('[data-testid="jarvis-provider-model-selector"]')
  await expect(selector).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await selector.click()

  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  const providerItem = menuPopup.locator('[role="menuitem"]').filter({ hasText: name }).first()
  await expect(providerItem).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  await providerItem.click()

  // After selecting provider, models load asynchronously.
  // Wait for a model item to appear and click it.
  await this.page.waitForTimeout(2000)
  const modelItems = this.page.locator('[role="menuitem"]:not(:has-text("Loading")):not(:has-text("No "))')
  const firstModel = modelItems.first()
  if (await firstModel.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await firstModel.click()
  }
  await this.page.keyboard.press('Escape')
})

Then('Jarvis 模型选择器应显示模型{string}', async function (this: CradleWorld, model: string) {
  const selector = this.page.locator('[data-testid="jarvis-provider-model-selector"]')
  await expect(selector).toBeVisible({ timeout: SETTINGS_TIMEOUT })
  // Model loads lazily after provider selection — poll until it appears
  await expect.poll(async () => {
    const text = await selector.textContent().catch(() => '')
    return text.includes(model) ? true : text
  }, { timeout: 30_000, message: `Expected Jarvis selector to contain "${model}"` }).toBe(true)
})

Then('剪贴板中应包含文本{string}', async function (this: CradleWorld, text: string) {
  await expect.poll(
    async () => this.page.evaluate(() => navigator.clipboard.readText()),
    { timeout: SETTINGS_TIMEOUT },
  ).toContain(text)
})

Then('Support 设置状态应显示{string}', async function (this: CradleWorld, text: string) {
  await expect(this.page.locator('[data-testid="support-settings-status"]')).toContainText(text, { timeout: SETTINGS_TIMEOUT })
})

Then('外观主题{string}应处于选中状态', async function (this: CradleWorld, label: string) {
  await expect(this.page.locator(`[data-testid="appearance-theme-${themeId(label)}"]`)).toHaveAttribute('data-theme-selected', 'true', { timeout: SETTINGS_TIMEOUT })
})

Then('应用应切换到深色主题', async function (this: CradleWorld) {
  await expect.poll(
    async () => this.page.evaluate(() => document.documentElement.classList.contains('dark')),
    { timeout: SETTINGS_TIMEOUT },
  ).toBe(true)
})

Then('应用应切换到浅色主题', async function (this: CradleWorld) {
  await expect.poll(
    async () => this.page.evaluate(() => document.documentElement.classList.contains('dark')),
    { timeout: SETTINGS_TIMEOUT },
  ).toBe(false)
})
