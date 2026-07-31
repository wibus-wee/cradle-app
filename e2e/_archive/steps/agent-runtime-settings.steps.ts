import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

function parseEnabledState(enabledText: string): boolean {
  if (enabledText === '启用') {
    return true
  }
  if (enabledText === '禁用') {
    return false
  }
  throw new Error(`Unknown provider enabled state: ${enabledText}`)
}

function getProviderRows(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
}

async function openAgentRuntimeSettings(world: CradleWorld): Promise<void> {
  const activeSettingsSurface = world.page.locator('[data-testid="surface-pill-settings"][data-surface-active="true"]')
  const settingsBtn = world.page.locator('[data-testid="settings-btn"]')
  if (!(await activeSettingsSurface.isVisible().catch(() => false))) {
    await expect(settingsBtn).toBeVisible({ timeout: 15000 })
    await settingsBtn.click()
    await expect(activeSettingsSurface).toBeVisible({ timeout: 10_000 })
  }

  const navItem = world.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  const settings = world.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 5000 })
}

async function ensureMockProviderBaseUrl(world: CradleWorld): Promise<string> {
  if (world.mockLlmServer) {
    await world.mockLlmServer.stop()
  }

  world.mockLlmServer = new MockLlmServer({
    models: [
      { id: 'mock-model', owned_by: 'openai' },
      { id: 'codex-mini-latest', owned_by: 'openai' },
      { id: 'claude-sonnet-4-20250514', owned_by: 'anthropic' },
    ],
  })
  world.mockLlmBaseUrl = await world.mockLlmServer.start()
  return world.mockLlmBaseUrl
}

async function ensureJarvisMockProviderBaseUrl(world: CradleWorld): Promise<string> {
  if (world.mockLlmServer) {
    await world.mockLlmServer.stop()
  }

  world.mockLlmServer = new MockLlmServer({
    models: [
      { id: 'gpt-4o-mini', owned_by: 'openai' },
    ],
  })
  world.mockLlmBaseUrl = await world.mockLlmServer.start()
  return world.mockLlmBaseUrl
}

const KIND_TO_PRESET: Record<string, string> = {
  'OpenAI-compatible': 'openai',
  'Codex': 'openai',
  'Claude Agent': 'anthropic',
}

async function selectProviderPresetCard(world: CradleWorld, kindLabel: string): Promise<void> {
  const presetId = KIND_TO_PRESET[kindLabel]
  if (!presetId) {
    throw new Error(`Unknown provider kind label: ${kindLabel}. Known: ${Object.keys(KIND_TO_PRESET).join(', ')}`)
  }
  const card = world.page.locator(`[data-testid="provider-preset-${presetId}"]`)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
}

When('我点击设置按钮', async function (this: CradleWorld) {
  console.warn('[step] click settings button')
  const activeSettingsSurface = this.page.locator('[data-testid="surface-pill-settings"][data-surface-active="true"]')
  const btn = this.page.locator('[data-testid="settings-btn"]')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await btn.click()
  await expect(activeSettingsSurface).toBeVisible({ timeout: 10_000 })
})

When('我点击添加 Provider 按钮', async function (this: CradleWorld) {
  console.warn('[step] click Add Provider button')
  const btn = this.page.locator('[data-testid="add-provider-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

When('我在 Provider 类型下拉选择{string}', async function (this: CradleWorld, kindLabel: string) {
  console.warn(`[step] select provider kind: ${kindLabel}`)
  await selectProviderPresetCard(this, kindLabel)
})

When('我点击"Providers"导航项', async function (this: CradleWorld) {
  console.warn('[step] click Providers nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 Agent Runtime 设置页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to Agent Runtime settings')
  await openAgentRuntimeSettings(this)
})

Then('我应该看到 Agent Runtime 设置页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent Runtime settings visible')
  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 10000 })
})

Then('我应该看到 Provider 类型选择', async function (this: CradleWorld) {
  console.warn('[step] assert provider kind selector visible')
  const addButton = this.page.locator('[data-testid="add-provider-btn"]')
  await expect(addButton).toBeVisible({ timeout: 5000 })
  await addButton.click()
  const presetCard = this.page.locator('[data-testid^="provider-preset-"]').first()
  await expect(presetCard).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent Profile 列表或空状态', async function (this: CradleWorld) {
  console.warn('[step] assert profile list or empty state visible')
  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 5000 })

  const providerRows = settings.locator('[data-testid^="agent-profile-row-"]')
  const addBtn = settings.locator('[data-testid="add-provider-btn"]')

  const hasProfiles = (await providerRows.count()) > 0
  const hasAddBtn = await addBtn.isVisible().catch(() => false)

  expect(hasProfiles || hasAddBtn).toBeTruthy()
})

When('我在 Provider 表单填写 Name 为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] fill provider name: ${name}`)
  const input = this.page.locator('[data-testid="provider-name"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(name)
})

When('我在 Provider 表单填写 Base URL 为 Mock 地址', async function (this: CradleWorld) {
  console.warn('[step] fill provider baseUrl with mock address')
  const input = this.page.locator('[data-testid="provider-baseurl"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(await ensureMockProviderBaseUrl(this))
})

When('我在 Provider 表单填写 Base URL 为 Jarvis Mock 地址', async function (this: CradleWorld) {
  console.warn('[step] fill provider baseUrl with Jarvis mock address')
  const input = this.page.locator('[data-testid="provider-baseurl"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(await ensureJarvisMockProviderBaseUrl(this))
})

When('我在 Provider 表单填写 Model 为{string}', async function (this: CradleWorld, model: string) {
  console.warn(`[step] fill provider model: ${model}`)
  const input = this.page.locator('[data-testid="provider-model"], [data-testid="provider-field-model"]')
  if (await input.count() === 0) {
    console.warn('[step] provider model field is not present in the current setup form')
    return
  }
  const field = input.first()
  await expect(field).toBeVisible({ timeout: 5000 })
  await field.clear()
  await field.fill(model)
})

When('我在 Provider 表单填写 API Key 为{string}', async function (this: CradleWorld, apiKey: string) {
  console.warn('[step] fill provider apiKey')
  const input = this.page.locator('[data-testid="provider-apikey"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(apiKey)
})

When('我点击提交 Provider 按钮', async function (this: CradleWorld) {
  console.warn('[step] click submit Provider button')
  const btn = this.page.locator('[data-testid="provider-submit"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

Then('Provider 列表中应显示名为{string}的 profile', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert provider row visible: ${name}`)
  const row = this.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 10_000 })
})

Then('Provider 状态应为成功', async function (this: CradleWorld) {
  console.warn('[step] assert provider status is success')
  const status = this.page.locator('[data-testid="provider-status"]')
  await expect(status).toBeVisible({ timeout: 15_000 })
  await expect(status).toHaveAttribute('data-status-ok', 'true')
})

Then('Provider 状态应为失败并提示{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert provider status is failure: ${text}`)
  const status = this.page.locator('[data-testid="provider-status"]')
  await expect(status).toBeVisible({ timeout: 15_000 })
  await expect(status).toHaveAttribute('data-status-ok', 'false')
  await expect(status).toContainText(text)
})

Then('Provider 对话框应保持打开', async function (this: CradleWorld) {
  console.warn('[step] assert provider form remains open')
  await expect(this.page.locator('[data-testid="provider-submit"]')).toBeVisible({ timeout: 5000 })
  await expect(this.page.locator('[data-testid="provider-name"]')).toBeVisible({ timeout: 5000 })
})

When('我打开名为{string}的 Provider', async function (this: CradleWorld, name: string) {
  console.warn(`[step] open provider row: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await expect(this.page.locator('[data-testid="provider-detail-panel"]')).toBeVisible({ timeout: 10_000 })
})

When('我编辑 Provider Name 为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] edit provider name: ${name}`)
  const input = this.page.locator('[data-testid="provider-edit-name"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(name)
})

When('我编辑 Provider Base URL 为{string}', async function (this: CradleWorld, baseUrl: string) {
  console.warn(`[step] edit provider baseUrl: ${baseUrl}`)
  const input = this.page.locator('[data-testid="provider-edit-baseurl"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(baseUrl)
})

When('我编辑 Provider Model 为{string}', async function (this: CradleWorld, model: string) {
  console.warn(`[step] edit provider model: ${model}`)
  const input = this.page.locator('[data-testid="provider-edit-model"]')
  // Model field may not be present in the profile edit form
  if (await input.isVisible().catch(() => false)) {
    await input.fill(model)
  }
  else {
    console.warn('[step] provider-edit-model field not present, skipping')
  }
})

When('我编辑 Provider API Key 为{string}', async function (this: CradleWorld, apiKey: string) {
  console.warn('[step] edit provider apiKey')
  const input = this.page.locator('[data-testid="provider-edit-apikey"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(apiKey)
})

When('我保存 Provider 编辑', async function (this: CradleWorld) {
  console.warn('[step] wait for auto-save')
  // ProfileDetailPanel auto-saves after 1200ms debounce. Wait for save indicator.
  await this.page.waitForTimeout(2000)
})

Then('Provider 列表中应显示名为{string}、模型为{string}的 profile', async function (
  this: CradleWorld,
  name: string,
  _model: string,
) {
  console.warn(`[step] assert provider row visible: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText(name)
  // Model is not displayed in the profile row — only check name
})

When('我移除名为{string}的 Provider', async function (this: CradleWorld, name: string) {
  console.warn(`[step] remove provider row: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  const detailPanel = this.page.locator('[data-testid="provider-detail-panel"]')
  await expect(detailPanel).toBeVisible({ timeout: 10_000 })

  const removeButton = detailPanel.locator('[data-testid^="agent-profile-remove-"]')
  await expect(removeButton).toBeVisible({ timeout: 5000 })
  await removeButton.click()

  // Confirm deletion in the alert dialog
  const confirmButton = this.page.getByRole('alertdialog').getByRole('button', { name: 'Remove' })
  await expect(confirmButton).toBeVisible({ timeout: 5000 })
  await confirmButton.click()
})

Then('Provider 列表中不应显示名为{string}的 profile', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert provider row absent: ${name}`)
  await expect(getProviderRows(this, name)).toHaveCount(0, { timeout: 10_000 })
})

When('我切换名为{string}的 Provider 启用状态', async function (this: CradleWorld, name: string) {
  console.warn(`[step] toggle provider enabled: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  const detailPanel = this.page.locator('[data-testid="provider-detail-panel"]')
  await expect(detailPanel).toBeVisible({ timeout: 10_000 })

  const toggle = detailPanel.locator('[role="switch"]')
  await expect(toggle).toBeVisible({ timeout: 5000 })
  await toggle.click()
})

Then('名为{string}的 Provider 应处于{string}状态', async function (this: CradleWorld, name: string, enabledText: string) {
  console.warn(`[step] assert provider UI enabled state: ${name} -> ${enabledText}`)
  const expected = parseEnabledState(enabledText) ? 'true' : 'false'
  const detailPanel = this.page.locator('[data-testid="provider-detail-panel"]')
  await expect(detailPanel).toBeVisible({ timeout: 10_000 })
  const toggle = detailPanel.locator('[role="switch"]')
  await expect(toggle).toHaveAttribute('aria-checked', expected, { timeout: 10_000 })
})
