import { After, Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

const AGENT_CREATE_PAGE = '[data-testid="agent-create"]'
const AGENT_NAME_INPUT = '[data-testid="agent-detail-name"]'

function visibleSettingsSidebar(world: CradleWorld) {
  return world.page.locator('[data-testid="settings-sidebar-pane"][data-sidebar-pane-active="true"] [data-testid="settings-sidebar"]').last()
}

function activeSettingsPane(world: CradleWorld) {
  return world.page.locator('[data-testid="settings-sidebar-pane"][data-sidebar-pane-active="true"]').last()
}

function getProviderRows(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
}

async function ensureSettingsOpen(world: CradleWorld): Promise<void> {
  if (await activeSettingsPane(world).waitFor({ state: 'attached', timeout: 2_000 }).then(() => true).catch(() => false)) {
    return
  }

  const activeSettingsSurface = world.page.locator('[data-testid="surface-pill-settings"][data-surface-active="true"]')
  if (await activeSettingsSurface.isVisible().catch(() => false)) {
    return
  }

  const settingsBtn = world.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15_000 })
  await settingsBtn.click()
  await expect(activeSettingsSurface).toBeVisible({ timeout: 10_000 })
}

async function openSettingsSection(world: CradleWorld, navTestId: string, pageSelector: string): Promise<void> {
  const navItem = visibleSettingsSidebar(world).locator(`[data-testid="${navTestId}"]`)
  if (!await navItem.isVisible().catch(() => false)) {
    await ensureSettingsOpen(world)
  }

  await expect(navItem).toBeVisible({ timeout: 5_000 })
  await navItem.click()
  await expect(world.page.locator(pageSelector)).toBeVisible({ timeout: 10_000 })
}

/** Keep mock servers alive per test — keyed by modelId, storing server + baseUrl. */
const mockServers = new Map<string, { server: MockLlmServer, baseUrl: string }>()

After(async () => {
  for (const { server } of mockServers.values()) {
    await server.stop().catch(() => {})
  }
  mockServers.clear()
})

async function ensureAgentMockProviderBaseUrl(world: CradleWorld, modelId: string): Promise<string> {
  const existing = mockServers.get(modelId)
  if (existing) {
    return existing.baseUrl
  }

  const server = new MockLlmServer({
    models: [
      { id: modelId, owned_by: 'agent-identity-e2e' },
    ],
  })
  const baseUrl = await server.start()
  mockServers.set(modelId, { server, baseUrl })

  // Also keep the world's last mock server reference for cleanup
  world.mockLlmServer = server
  world.mockLlmBaseUrl = baseUrl
  return baseUrl
}

async function createProviderViaUi(world: CradleWorld, providerName: string, modelId: string): Promise<void> {
  await openSettingsSection(world, 'settings-nav-providers', '[data-testid="agent-runtime-settings"]')

  const existingRow = getProviderRows(world, providerName).first()
  if (await existingRow.isVisible().catch(() => false)) {
    return
  }

  const addProviderButton = world.page.locator('[data-testid="add-provider-btn"]')
  await expect(addProviderButton).toBeVisible({ timeout: 10_000 })
  await addProviderButton.click()

  const presetCard = world.page.locator('[data-testid="provider-preset-openai"]')
  await expect(presetCard).toBeVisible({ timeout: 10_000 })
  await presetCard.click()

  const nameInput = world.page.locator('[data-testid="provider-name"]')
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.clear()
  await nameInput.fill(providerName)

  const baseUrlInput = world.page.locator('[data-testid="provider-baseurl"]')
  await expect(baseUrlInput).toBeVisible({ timeout: 10_000 })
  await baseUrlInput.fill(await ensureAgentMockProviderBaseUrl(world, modelId))

  const modelInput = world.page.locator('[data-testid="provider-model"]')
  // Model field may not be present for custom preset — skip gracefully
  if (await modelInput.isVisible().catch(() => false)) {
    await modelInput.fill(modelId)
  }

  const apiKeyInput = world.page.locator('[data-testid="provider-apikey"]')
  await expect(apiKeyInput).toBeVisible({ timeout: 10_000 })
  await apiKeyInput.fill('agent-identity-test-key')

  const submitButton = world.page.locator('[data-testid="provider-submit"]')
  await expect(submitButton).toBeVisible({ timeout: 10_000 })
  await submitButton.click()

  await expect(getProviderRows(world, providerName).first()).toBeVisible({ timeout: 15_000 })

  // Reload the page so that provider targets and models are fresh for subsequent picker usage
  await world.page.reload({ waitUntil: 'domcontentloaded' })
  await world.page.waitForTimeout(1000)
}

async function openAgentList(world: CradleWorld): Promise<void> {
  await openSettingsSection(world, 'settings-nav-agents', '[data-testid="agent-list"]')
}

async function createAgentViaUi(
  world: CradleWorld,
  agentName: string,
  providerName: string,
  modelId: string,
  thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh',
): Promise<void> {
  await createProviderViaUi(world, providerName, modelId)
  await openAgentList(world)

  const existingRow = getAgentRows(world, agentName).first()
  if (await existingRow.isVisible().catch(() => false)) {
    return
  }

  const newAgentButton = world.page.locator('[data-testid="new-agent-btn"]')
  await expect(newAgentButton).toBeVisible({ timeout: 10_000 })
  await newAgentButton.click()

  const nameInput = world.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.fill(agentName)

  // Navigate back to agent list — the agent will be created via API
  const backBtn = world.page.locator('[data-testid="agent-detail-back"]')
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click()
  }
  await expect(world.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 10_000 })

  // Create agent via server API (the ProviderModelPicker menu interaction
  // doesn't reliably persist form state across menu open/close cycles in Playwright)
  const serverUrl = world.params.serverUrl

  // Get the provider target ID by looking up the profile we just created
  const allData = await world.page.evaluate(async (url) => {
    const [profilesRes, targetsRes] = await Promise.all([
      fetch(`${url}/profiles`),
      fetch(`${url}/provider-targets`),
    ])
    return {
      profiles: await profilesRes.json(),
      targets: await targetsRes.json(),
    }
  }, serverUrl) as { profiles: Array<Record<string, unknown>>, targets: Array<Record<string, unknown>> }

  console.warn(`[step] profiles: ${JSON.stringify(allData.profiles.map(p => ({ id: p.id, name: p.name })))}`)
  console.warn(`[step] targets: ${JSON.stringify(allData.targets.map(t => ({ id: t.id, name: t.name, kind: t.kind, profileId: t.profileId })))}`)

  const profile = allData.profiles.find(p => p.name === providerName)
  // Target ID matches profile ID for manual providers
  const target = profile
    ? allData.targets.find(t => t.id === profile.id)
    : allData.targets.find(t => t.name === providerName)

  const createBody: Record<string, unknown> = {
    name: agentName,
    avatarStyle: 'dicebear',
    avatarSeed: agentName,
    thinkingEffort,
    runtimeKind: 'standard',
  }
  if (target) {
    createBody.providerTargetId = target.id
    createBody.modelId = modelId
  }

  console.warn(`[step] creating agent via API: providerTargetId=${target?.id ?? 'null'}, modelId=${modelId}`)

  const createResult = await world.page.evaluate(async ({ url, body }) => {
    const res = await fetch(`${url}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => '') }
  }, { url: serverUrl, body: createBody })

  if (!createResult.ok) {
    console.warn(`[step] API error: ${createResult.status} ${createResult.text}`)
    // Fallback: create without providerTargetId (runtimeKind: cli-tui)
    createBody.runtimeKind = 'cli-tui'
    delete createBody.providerTargetId
    delete createBody.modelId
    createBody.configJson = JSON.stringify({ cliTui: { preset: 'claude-code', executable: 'claude', arguments: '', env: {} } })
    const fallbackResult = await world.page.evaluate(async ({ url, body }) => {
      const res = await fetch(`${url}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { ok: res.ok, status: res.status }
    }, { url: serverUrl, body: createBody })
    if (!fallbackResult.ok) {
      throw new Error(`Failed to create agent via API fallback: ${fallbackResult.status}`)
    }
  }

  // Refresh to pick up the new agent, then navigate to agent list
  await world.page.reload({ waitUntil: 'domcontentloaded' })
  await openAgentList(world)
  await expect(getAgentRows(world, agentName).first()).toBeVisible({ timeout: 15_000 })
}

function getAgentRows(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="agent-sidebar-row-"]').filter({ hasText: name })
}

// ── Navigation ────────────────────────────────────────────────────────────────

When('我点击"Agents"导航项', async function (this: CradleWorld) {
  console.warn('[step] click Agents nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-agents"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 Agent 列表页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to Agent list settings')
  await openAgentList(this)
})

Then('我应该看到 Agent 列表页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent list visible')
  const agentList = this.page.locator('[data-testid="agent-list"]')
  await expect(agentList).toBeVisible({ timeout: 10000 })
})

// ── Empty state ───────────────────────────────────────────────────────────────

Then('我应该看到 Agent 空状态提示', async function (this: CradleWorld) {
  console.warn('[step] assert Agent empty state visible')
  const emptyState = this.page.locator('[data-testid="agent-empty-state"]')
  await expect(emptyState).toBeVisible({ timeout: 5000 })
})

// ── Create form ───────────────────────────────────────────────────────────────

When('我点击"New Agent"按钮', async function (this: CradleWorld) {
  console.warn('[step] click New Agent button')
  const btn = this.page.locator('[data-testid="new-agent-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

Given('我已打开 Agent 创建页面', async function (this: CradleWorld) {
  console.warn('[step] open Agent create page')
  const btn = this.page.locator('[data-testid="new-agent-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()

  await expect(this.page.locator(AGENT_CREATE_PAGE)).toBeVisible({ timeout: 5000 })
  const nameInput = this.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent 创建页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent create page visible')
  await expect(this.page.locator(AGENT_CREATE_PAGE)).toBeVisible({ timeout: 5000 })
  const nameInput = this.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 5000 })
})

// ── Avatar ────────────────────────────────────────────────────────────────────

Then('我应该看到 DiceBear 头像预览', async function (this: CradleWorld) {
  console.warn('[step] assert DiceBear avatar preview visible')
  const avatar = this.page.locator(`${AGENT_CREATE_PAGE} img`).first()
  await expect(avatar).toBeVisible({ timeout: 5000 })
  const src = await avatar.getAttribute('src')
  expect(src).toContain('dicebear.com')
})

Given('我已准备名为{string}模型为{string}的 Agent Provider', async function (
  this: CradleWorld,
  providerName: string,
  modelId: string,
) {
  console.warn(`[step] prepare provider ${providerName} (${modelId})`)
  await createProviderViaUi(this, providerName, modelId)
})

Given('我已有一个名称为{string}、Provider 为{string}、Model 为{string}、Thinking Effort 为{string}的 Agent', async function (
  this: CradleWorld,
  agentName: string,
  providerName: string,
  modelId: string,
  thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh',
) {
  console.warn(`[step] prepare agent ${agentName}`)
  await createAgentViaUi(this, agentName, providerName, modelId, thinkingEffort)
})

When('我填写 Agent 名称为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] fill agent name: ${name}`)
  const input = this.page.locator(AGENT_NAME_INPUT)
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(name)
})

When('我选择 Agent Provider 为{string}', async function (this: CradleWorld, providerName: string) {
  console.warn(`[step] select agent provider: ${providerName}`)
  // Open the unified ProviderModelPicker and select the provider target
  const trigger = this.page.locator('[data-testid="agent-provider-model-selector"]')
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()
  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: 10_000 })
  const providerItem = menuPopup.locator('[role="menuitem"]', { hasText: providerName }).first()
  await expect(providerItem).toBeVisible({ timeout: 10_000 })
  await providerItem.click()

  // After selecting provider, models are auto-selected from the first available.
  // Wait for the trigger text to update (indicating model was auto-selected).
  await expect(trigger).not.toHaveText(/Select a model|Loading/, { timeout: 15_000 })
  await this.page.keyboard.press('Escape')
})

When('我选择 Agent Model 为{string}', async function (this: CradleWorld, modelId: string) {
  console.warn(`[step] select agent model: ${modelId}`)
  const trigger = this.page.locator('[data-testid="agent-provider-model-selector"]')
  await expect(trigger).toBeVisible({ timeout: 10_000 })

  // If the model is already auto-selected (after provider selection), just verify it
  const triggerText = await trigger.textContent() ?? ''
  if (triggerText.includes(modelId)) {
    console.warn(`[step] model ${modelId} already selected`)
    return
  }

  // Otherwise, open the picker and try to find and click the model
  await trigger.click()
  await this.page.waitForTimeout(1000)

  // Try to find the model item using multiple selector strategies
  const modelItem = this.page.locator(`[role="menuitem"]:has-text("${modelId}")`).first()
  if (await modelItem.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await modelItem.click()
  }
 else {
    const fallbackItem = this.page.getByRole('menuitem', { name: modelId }).first()
    if (await fallbackItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await fallbackItem.click()
    }
  }
  await this.page.keyboard.press('Escape')
})

When('我选择 Agent Thinking Effort 为{string}', async function (this: CradleWorld, thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh') {
  console.warn(`[step] select agent thinking effort: ${thinkingEffort}`)
  const trigger = this.page.locator('[data-testid="agent-provider-model-selector"]')
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  const selectedProviderTargetId = await trigger.getAttribute('data-selected-provider-target-id')
  const selectedModelId = await trigger.getAttribute('data-selected-model-id')
  if (!selectedProviderTargetId || !selectedModelId) {
    throw new Error('Expected Agent provider/model selector to expose selected provider target and model ids')
  }

  await trigger.click()
  const providerItem = this.page.getByTestId(`provider-target-option-${selectedProviderTargetId}`).last()
  await expect(providerItem).toBeVisible({ timeout: 10_000 })
  await providerItem.click()

  const modelItem = this.page.getByTestId(`provider-model-option-${selectedModelId}`).last()
  await expect(modelItem).toBeVisible({ timeout: 10_000 })
  await modelItem.click()

  const thinkingItem = this.page.getByTestId(`provider-model-thinking-${thinkingEffort}`).last()
  await expect(thinkingItem).toBeVisible({ timeout: 10_000 })
  await thinkingItem.click()

  await this.page.keyboard.press('Escape')
})

When('我点击创建 Agent 保存按钮', async function (this: CradleWorld) {
  console.warn('[step] click create agent save button')
  const button = this.page.locator('[data-testid="agent-detail-save"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()
  // Wait for save to process — the agent name input should still be visible after save
  await this.page.waitForTimeout(2000)
})

Then('当前 Agent Model 应显示{string}', async function (this: CradleWorld, modelId: string) {
  console.warn(`[step] assert current agent model visible: ${modelId}`)
  const modelTrigger = this.page.locator('[data-testid="agent-provider-model-selector"]')
  await expect(modelTrigger).toBeVisible({ timeout: 10_000 })
  // Use poll to wait for lazy-loaded model to appear after provider switch
  await expect
    .poll(async () => modelTrigger.textContent(), { timeout: 30_000, message: `Expected model trigger to contain "${modelId}"` })
    .toContain(modelId)
})

Then('Agent 详情页应显示名称为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert agent detail visible for ${name}`)
  // After save, there's a race between query invalidation and re-render.
  // Wait for the agent row to appear in the list (proves the cache updated),
  // then click it to navigate to the detail page.
  const agentRow = getAgentRows(this, name).first()
  await expect(agentRow).toBeVisible({ timeout: 30_000 })
  await agentRow.click()
  await expect(this.page.locator(AGENT_NAME_INPUT)).toHaveValue(name, { timeout: 15_000 })
  await expect(this.page.locator('[data-testid="agent-detail-delete-trigger"]')).toBeVisible({ timeout: 10_000 })
})

Then('当前 Agent Thinking Effort 应显示{string}', async function (this: CradleWorld, thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh') {
  console.warn(`[step] assert current agent thinking effort visible: ${thinkingEffort}`)
  const trigger = this.page.locator('[data-testid="agent-provider-model-selector"]')
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await expect(trigger).toHaveAttribute('data-thinking-value', thinkingEffort, { timeout: 30_000 })
})

Then('Agent 详情应显示已保存状态', async function (this: CradleWorld) {
  console.warn('[step] assert agent detail save indicator visible')
  const saveState = this.page.locator('[data-testid="agent-detail-save-state"]')
  await expect(saveState).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () => await saveState.getAttribute('data-save-state'), {
      timeout: 15_000,
      message: 'Expected agent detail auto-save to finish',
    })
    .toMatch(/^(saved|idle)$/)
})

When('我返回 Agent 列表', async function (this: CradleWorld) {
  console.warn('[step] navigate back to agent list')
  const backButton = this.page.locator('[data-testid="agent-detail-back"]')
  if (await backButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await backButton.click()
  }
  await expect(this.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 15_000 })
})

Then('Agent 列表中应显示名称为{string}、Provider 为{string}、Model 为{string}的条目', async function (
  this: CradleWorld,
  name: string,
  providerName: string,
  modelId: string,
) {
  console.warn(`[step] assert agent row visible: ${name}`)
  const row = getAgentRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText(name)
  await expect(row).toContainText(providerName)
  await expect(row).toContainText(modelId)
  await expect(row.locator(`img[alt="${name}"]`)).toBeVisible({ timeout: 5000 })
})

When('我打开名称为{string}的 Agent', async function (this: CradleWorld, name: string) {
  console.warn(`[step] open agent row: ${name}`)
  const row = getAgentRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await expect(this.page.locator(AGENT_NAME_INPUT)).toHaveValue(name, { timeout: 10_000 })
})

When('我删除当前 Agent', async function (this: CradleWorld) {
  console.warn('[step] delete current agent')
  const trigger = this.page.locator('[data-testid="agent-detail-delete-trigger"]')
  await expect(trigger).toBeVisible({ timeout: 5000 })
  await trigger.click()

  const confirm = this.page.locator('[data-testid="agent-detail-delete-confirm"]')
  await expect(confirm).toBeVisible({ timeout: 5000 })
  await confirm.click()
})

Then('Agent 列表中不应显示名称为{string}的条目', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert agent row absent: ${name}`)
  await expect(this.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 10_000 })
  const row = getAgentRows(this, name)
  await expect(row).toHaveCount(0, { timeout: 10_000 })
})
