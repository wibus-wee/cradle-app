import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  configureProviderDisableGatedSimulator,
  expectProviderDisableGatesCanceled,
} from '../support/helpers/provider-scenario'
import { anthropicScenario, anthropicTextExchange } from '../support/scenarios/anthropic'
import type { CradleWorld } from '../support/world'

const TIMEOUT = 15_000
const PROVIDER_SESSION_ALIASES_KEY = 'provider.session-aliases'

const KIND_TO_PRESET: Record<string, string> = {
  'Anthropic': 'anthropic',
  'OpenAI': 'openai',
  'Universal': 'universal',
  // Legacy labels from archived features
  'Claude Agent': 'anthropic',
  'OpenAI-compatible': 'openai',
  'Codex': 'openai',
}

async function openProvidersSettings(world: CradleWorld): Promise<void> {
  // Proven path in E2E: command palette → Open settings (surface-pill may vary by chrome).
  await world.search.open()
  await world.search.fill('>settings')
  await world.search.runCommand('Open settings')
  await world.settingsPage.expectSettingsMode()

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
  const input = this.page.locator(
    '[data-testid="provider-baseurl"], [data-testid="provider-anthropic-baseurl"]',
  ).first()
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

Then('Provider 列表中不应显示名为{string}的 profile', async function (this: CradleWorld, name: string) {
  const row = this.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
  await expect(row).toHaveCount(0, { timeout: TIMEOUT })
})

When('我为 UI 创建的 Provider 准备真实 Claude 回复', async function (this: CradleWorld) {
  const simulator = await this.ensureSimulator()
  simulator.reset()
  this.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'ui-provider-chat',
      text: 'UI Provider 已完成真实 Claude Agent 回复',
      bodyTextIncludes: '验证 UI Provider 闭环',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
})

When('我在新建聊天选择名为{string}的 Claude Agent Provider', async function (this: CradleWorld, name: string) {
  await this.newChat.selectRuntime('Claude Agent')
  await this.newChat.selectProvider(new RegExp(name, 'i'))
})

When('我在 Providers 设置中打开名为{string}的 profile', async function (this: CradleWorld, name: string) {
  await openProvidersSettings(this)
  const row = this.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name }).first()
  await expect(row).toBeVisible({ timeout: TIMEOUT })
  await row.click()
  await expect(this.page.locator('[data-testid="provider-detail-panel"]')).toBeVisible({ timeout: TIMEOUT })
})

When('我禁用当前 Provider', async function (this: CradleWorld) {
  const toggle = this.page.locator('[data-testid="provider-enabled-toggle"]')
  await expect(toggle).toBeVisible({ timeout: TIMEOUT })
  await toggle.click()
  await expect(this.page.locator('[data-testid="provider-detail-panel"]')).toContainText('Off', { timeout: TIMEOUT })
})

When('我删除当前 Provider', async function (this: CradleWorld) {
  const removeButton = this.page.locator('[aria-label="Remove provider"]')
  await expect(removeButton).toBeVisible({ timeout: TIMEOUT })
  await removeButton.click()

  const dialog = this.page.getByRole('alertdialog')
  await expect(dialog).toBeVisible({ timeout: TIMEOUT })
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: TIMEOUT })
})

Given('我已为 Provider 禁用准备两个门控 Claude 运行', async function (this: CradleWorld) {
  await configureProviderDisableGatedSimulator(this)
})

When('我记住当前 Provider 会话为{string}', async function (this: CradleWorld, alias: string) {
  const aliases = this.maybeRecall<Record<string, string>>(PROVIDER_SESSION_ALIASES_KEY) ?? {}
  this.remember(PROVIDER_SESSION_ALIASES_KEY, {
    ...aliases,
    [alias]: await this.chat.sessionId(),
  })
})

Then('两个 Provider 慢速响应均应已取消', function (this: CradleWorld) {
  expectProviderDisableGatesCanceled(this)
})

When('我打开已记住的 Provider 会话{string}', async function (this: CradleWorld, alias: string) {
  const sessionId = this.maybeRecall<Record<string, string>>(PROVIDER_SESSION_ALIASES_KEY)?.[alias]
  if (!sessionId) {
    throw new Error(`Missing remembered Provider session alias: ${alias}`)
  }
  await this.chat.openSession(sessionId)
})

Then('新建聊天中不应提供名为{string}的 Provider', async function (this: CradleWorld, name: string) {
  const closeSettings = this.page.locator('[data-testid="settings-close"]')
  await expect(closeSettings).toBeVisible({ timeout: TIMEOUT })
  await closeSettings.click()
  await this.newChat.openFromNav()
  await this.newChat.selectRuntime('Claude Agent')
  const selector = this.page.locator('[data-testid="provider-model-selector"], [data-testid="agent-selector"]').filter({ visible: true }).first()
  await selector.click()
  const menu = this.page.locator('[role="menu"]').last()
  await expect(menu).toBeVisible({ timeout: TIMEOUT })
  await expect(menu.locator('[role="menuitem"]', { hasText: name })).toHaveCount(0)
})
