import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const TIMEOUT = 15_000

const KIND_TO_PRESET: Record<string, string> = {
  'OpenAI-compatible': 'openai',
  'Codex': 'openai',
  'Claude Agent': 'anthropic',
}

async function openProvidersSettings(world: CradleWorld): Promise<void> {
  const activeSettings = world.page.locator('[data-testid="surface-pill-settings"][data-surface-active="true"]')
  if (!(await activeSettings.isVisible().catch(() => false))) {
    const settingsBtn = world.page.locator('[data-testid="settings-btn"]')
    await expect(settingsBtn).toBeVisible({ timeout: TIMEOUT })
    await settingsBtn.click()
    await expect(activeSettings).toBeVisible({ timeout: TIMEOUT })
  }
  const navItem = world.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: TIMEOUT })
  await navItem.click()
  await expect(world.page.locator('[data-testid="agent-runtime-settings"]')).toBeVisible({ timeout: TIMEOUT })
}

Given('Simulator 已启动', async function (this: CradleWorld) {
  await this.ensureSimulator()
})

When('我打开 Providers 设置页', async function (this: CradleWorld) {
  await openProvidersSettings(this)
})

When('我点击添加 Provider 按钮', async function (this: CradleWorld) {
  const btn = this.page.locator('[data-testid="add-provider-btn"]')
  await expect(btn).toBeVisible({ timeout: TIMEOUT })
  await btn.click()
})

When('我在 Provider 类型下拉选择{string}', async function (this: CradleWorld, kindLabel: string) {
  const presetId = KIND_TO_PRESET[kindLabel]
  if (!presetId) {
    throw new Error(`Unknown provider kind: ${kindLabel}`)
  }
  const card = this.page.locator(`[data-testid="provider-preset-${presetId}"]`)
  await expect(card).toBeVisible({ timeout: TIMEOUT })
  await card.click()
})

When('我在 Provider 表单填写 Name 为{string}', async function (this: CradleWorld, name: string) {
  const input = this.page.locator('[data-testid="provider-name"]')
  await expect(input).toBeVisible({ timeout: TIMEOUT })
  await input.fill(name)
})

When('我在 Provider 表单填写 Base URL 为 Anthropic Simulator 地址', async function (this: CradleWorld) {
  const simulator = await this.ensureSimulator()
  const input = this.page.locator('[data-testid="provider-baseurl"]')
  await expect(input).toBeVisible({ timeout: TIMEOUT })
  await input.fill(simulator.anthropicBaseUrl)
})

When('我在 Provider 表单填写 Model 为{string}', async function (this: CradleWorld, model: string) {
  const input = this.page.locator('[data-testid="provider-model"], [data-testid="provider-field-model"]').first()
  if (await input.count() === 0) {
    return
  }
  await expect(input).toBeVisible({ timeout: TIMEOUT })
  await input.fill(model)
})

When('我在 Provider 表单填写 API Key 为{string}', async function (this: CradleWorld, apiKey: string) {
  const input = this.page.locator('[data-testid="provider-apikey"]')
  await expect(input).toBeVisible({ timeout: TIMEOUT })
  await input.fill(apiKey)
})

When('我点击提交 Provider 按钮', async function (this: CradleWorld) {
  const btn = this.page.locator('[data-testid="provider-submit"]')
  await expect(btn).toBeVisible({ timeout: TIMEOUT })
  await btn.click()
})

Then('Provider 状态应为成功', async function (this: CradleWorld) {
  const status = this.page.locator('[data-testid="provider-status"]')
  await expect(status).toBeVisible({ timeout: 30_000 })
  await expect(status).toHaveAttribute('data-status-ok', 'true', { timeout: 30_000 })
})

Then('Provider 列表中应显示名为{string}的 profile', async function (this: CradleWorld, name: string) {
  const row = this.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: TIMEOUT })
})
