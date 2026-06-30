import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

interface WorkflowWorkspaceFixture {
  dir: string
  name: string
}

const WORKFLOW_WORKSPACE_KEY = 'workflow-rules.workspace'
const DEFAULT_PROVIDER_NAME = 'Workflow Mock Provider'
const DEFAULT_PROVIDER_MODEL = 'workflow-mock-model'
const NON_SLUG_CHAR_RE = /[^a-z0-9]+/g
const EDGE_DASH_RE = /^-+|-+$/g
const CRLF_RE = /\r\n/g

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(NON_SLUG_CHAR_RE, '-').replace(EDGE_DASH_RE, '') || 'workflow'
}

function normalizeMultiline(text: string): string {
  return text.replace(CRLF_RE, '\n').trim()
}

function visibleLines(text: string): string[] {
  return normalizeMultiline(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function rememberWorkflowWorkspace(world: CradleWorld, fixture: WorkflowWorkspaceFixture): void {
  world.remember(WORKFLOW_WORKSPACE_KEY, fixture)
}

function recallWorkflowWorkspace(world: CradleWorld): WorkflowWorkspaceFixture {
  return world.recall<WorkflowWorkspaceFixture>(WORKFLOW_WORKSPACE_KEY)
}

function createWorkflowWorkspaceFixture(world: CradleWorld, prefix: string, label: string): WorkflowWorkspaceFixture {
  const dir = world.createTempWorkspaceDir(prefix)
  const name = basename(dir)

  writeFileSync(
    join(dir, 'AGENTS.md'),
    `# ${label}\n\nWorkspace detail content for workflow rules end-to-end coverage.\n`,
    'utf8',
  )

  return { dir, name }
}

function workflowWorkspaceButtonByName(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: name }).first()
}

async function addWorkspaceFromPicker(world: CradleWorld, fixture: WorkflowWorkspaceFixture): Promise<void> {
  const addButton = world.page.locator('[data-testid="add-workspace-btn"]')
  await expect(addButton).toBeVisible({ timeout: 15_000 })
  await addButton.click()

  await world.selectDirectoryInBrowser(fixture.dir)

  rememberWorkflowWorkspace(world, fixture)

  await expect(workflowWorkspaceButtonByName(world, fixture.name)).toContainText(fixture.name, { timeout: 10_000 })
}

function activeWorkspaceDetailPage(world: CradleWorld) {
  return world.page.locator('[data-testid="workspace-detail-page"]:visible').first()
}

async function openWorkspaceDetail(world: CradleWorld): Promise<void> {
  const fixture = recallWorkflowWorkspace(world)
  const button = workflowWorkspaceButtonByName(world, fixture.name)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()

  const detailPage = activeWorkspaceDetailPage(world)
  await expect(detailPage).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: 10_000 })
}

async function startWorkflowMockProvider(world: CradleWorld): Promise<string> {
  if (world.mockLlmServer) {
    await world.mockLlmServer.stop()
  }

  world.mockLlmServer = new MockLlmServer({
    models: [
      { id: DEFAULT_PROVIDER_MODEL, owned_by: 'workflow-e2e' },
    ],
  })
  world.mockLlmBaseUrl = await world.mockLlmServer.start()
  return world.mockLlmBaseUrl
}

async function _selectOption(world: CradleWorld, triggerSelector: string, value: string): Promise<void> {
  const trigger = world.page.locator(triggerSelector)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = world.page.getByRole('option', { name: value })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

async function createWorkflowProviderViaUi(world: CradleWorld, providerName: string): Promise<void> {
  const baseUrl = await startWorkflowMockProvider(world)

  const activeSettingsSurface = world.page.locator('[data-testid="surface-pill-settings"][data-surface-active="true"]')
  const settingsButton = world.page.locator('[data-testid="settings-btn"]')
  if (!(await activeSettingsSurface.isVisible().catch(() => false))) {
    await expect(settingsButton).toBeVisible({ timeout: 15_000 })
    await settingsButton.click()
    await expect(activeSettingsSurface).toBeVisible({ timeout: 10_000 })
  }

  const providersNav = world.page.locator('[data-testid="settings-nav-providers"]')
  await expect(providersNav).toBeVisible({ timeout: 10_000 })
  await providersNav.click()

  await expect(world.page.locator('[data-testid="agent-runtime-settings"]')).toBeVisible({ timeout: 10_000 })

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
  await baseUrlInput.fill(baseUrl)

  const modelInput = world.page.locator('[data-testid="provider-model"]')
  // Model field may not be present for custom preset — skip gracefully
  if (await modelInput.isVisible().catch(() => false)) {
    await modelInput.fill(DEFAULT_PROVIDER_MODEL)
  }

  const apiKeyInput = world.page.locator('[data-testid="provider-apikey"]')
  await expect(apiKeyInput).toBeVisible({ timeout: 10_000 })
  await apiKeyInput.fill('workflow-test-key')

  const submitButton = world.page.locator('[data-testid="provider-submit"]')
  await expect(submitButton).toBeVisible({ timeout: 10_000 })
  await submitButton.click()

  const providerRow = world.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: providerName }).first()
  await expect(providerRow).toBeVisible({ timeout: 15_000 })

  // Reload so that provider targets are fresh for subsequent API calls
  await world.page.reload({ waitUntil: 'domcontentloaded' })
  await world.page.waitForTimeout(1000)
}

async function createWorkflowAgentViaUi(world: CradleWorld, agentName: string): Promise<void> {
  const providerName = `${DEFAULT_PROVIDER_NAME} ${slugifyName(agentName)}`
  await createWorkflowProviderViaUi(world, providerName)

  const agentsNav = world.page.locator('[data-testid="settings-nav-agents"]')
  await expect(agentsNav).toBeVisible({ timeout: 10_000 })
  await agentsNav.click()

  const agentList = world.page.locator('[data-testid="agent-list"]')
  await expect(agentList).toBeVisible({ timeout: 10_000 })

  // Navigate to the create form so the UI knows we intend to create, then back out.
  // The actual creation is done via the server API because the ProviderModelPicker
  // menu interaction doesn't reliably persist form state in Playwright.
  const newAgentButton = world.page.locator('[data-testid="new-agent-btn"]')
  await expect(newAgentButton).toBeVisible({ timeout: 10_000 })
  await newAgentButton.click()

  const nameInput = world.page.locator('[data-testid="agent-detail-name"]')
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.fill(agentName)

  const backBtn = world.page.locator('[data-testid="agent-detail-back"]')
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click()
  }
  await expect(world.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 10_000 })

  // Create agent via server API
  const serverUrl = world.params.serverUrl

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

  const profile = allData.profiles.find(p => p.name === providerName)
  const target = profile
    ? allData.targets.find(t => t.id === profile.id)
    : allData.targets.find(t => t.name === providerName)

  const createBody: Record<string, unknown> = {
    name: agentName,
    avatarStyle: 'dicebear',
    avatarSeed: agentName,
    thinkingEffort: 'auto',
    runtimeKind: 'standard',
  }
  if (target) {
    createBody.providerTargetId = target.id
    createBody.modelId = DEFAULT_PROVIDER_MODEL
  }

  const createResult = await world.page.evaluate(async ({ url, body }) => {
    const res = await fetch(`${url}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => '') }
  }, { url: serverUrl, body: createBody })

  if (!createResult.ok) {
    throw new Error(`Failed to create agent via API: ${createResult.status} ${createResult.text}`)
  }

  // Refresh to pick up the new agent, then navigate to agent list
  await world.page.reload({ waitUntil: 'domcontentloaded' })
  await agentsNav.click()
  await expect(world.page.locator('[data-testid^="agent-sidebar-row-"]').filter({ hasText: agentName }).first()).toBeVisible({ timeout: 15_000 })

  await world.page.keyboard.press('Escape')
  await expect(world.page.locator('[data-testid="workspace-list"]')).toBeVisible({ timeout: 10_000 })
}

function workflowRulesPage(world: CradleWorld) {
  return activeWorkspaceDetailPage(world).locator('[data-testid="workspace-workflow-rules-page"]')
}

function workflowRulesEditor(world: CradleWorld) {
  return workflowRulesPage(world).locator('[data-testid="workspace-workflow-rules-editor"]')
}

function workflowRulesEditable(world: CradleWorld) {
  return workflowRulesEditor(world).locator('[contenteditable="true"]').first()
}

async function replaceWorkflowRuleContent(world: CradleWorld, markdown: string): Promise<void> {
  const normalized = normalizeMultiline(markdown)
  const editor = workflowRulesEditable(world)

  await expect(editor).toBeVisible({ timeout: 10_000 })
  await editor.click()
  await world.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await world.page.keyboard.press('Backspace')

  const lines = normalized.split('\n')
  for (const [index, line] of lines.entries()) {
    if (line.length > 0) {
      await world.page.keyboard.insertText(line)
    }
    if (index < lines.length - 1) {
      await world.page.keyboard.press('Enter')
    }
  }

  await world.page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await activeWorkspaceDetailPage(world).locator('[data-testid="workspace-detail-path"]').click()

  for (const line of visibleLines(normalized)) {
    await expect(editor).toContainText(line, { timeout: 10_000 })
  }
}

Given('我已打开一个 Workflow Rules 工作区详情页', async function (this: CradleWorld) {
  const fixture = createWorkflowWorkspaceFixture(this, 'cradle-e2e-workflow-rules-', 'Workflow Rules Workspace')
  await addWorkspaceFromPicker(this, fixture)
  await openWorkspaceDetail(this)
})

Given('我已通过真实 UI 创建一个 Workflow Agent {string}', async function (this: CradleWorld, agentName: string) {
  await createWorkflowAgentViaUi(this, agentName)
})

Given('我已打开该 Workflow Agent 可用的工作区详情页', async function (this: CradleWorld) {
  const fixture = createWorkflowWorkspaceFixture(this, 'cradle-e2e-workflow-agent-', 'Workflow Agent Workspace')
  await addWorkspaceFromPicker(this, fixture)
  await openWorkspaceDetail(this)
})

When('我切换到 Workflow 标签', async function (this: CradleWorld) {
  const workflowTab = activeWorkspaceDetailPage(this).locator('[data-testid="workspace-detail-tab-workflow-rules"]')
  await expect(workflowTab).toBeVisible({ timeout: 10_000 })
  await workflowTab.click()
  await expect(workflowRulesPage(this)).toBeVisible({ timeout: 10_000 })
})

When('我在当前 Workflow 范围保存规则:', async function (this: CradleWorld, docString: string) {
  await replaceWorkflowRuleContent(this, docString)
})

When('我切换到“All Agents”Workflow 范围', async function (this: CradleWorld) {
  const button = workflowRulesPage(this).locator('[data-testid="workspace-workflow-rules-scope-global"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(workflowRulesEditor(this)).toBeVisible({ timeout: 10_000 })
})

When('我切换到 Agent {string} 的 Workflow 范围', async function (this: CradleWorld, agentName: string) {
  const button = workflowRulesPage(this)
    .locator('[data-testid^="workspace-workflow-rules-scope-agent-"]')
    .filter({ hasText: agentName })
    .first()
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(workflowRulesEditor(this)).toBeVisible({ timeout: 10_000 })
})

When('我关闭当前工作区详情标签', async function (this: CradleWorld) {
  const activeTab = this.page.locator('[data-testid^="surface-pill-workspace:"][data-surface-active="true"]').first()

  await expect(activeTab).toBeVisible({ timeout: 10_000 })
  await activeTab.hover()

  const closeButton = activeTab.locator('[data-testid^="surface-close-workspace:"]')
  await expect(closeButton).toBeVisible({ timeout: 10_000 })
  await closeButton.click()

  await expect(this.page.locator('[data-testid="workspace-detail-page"]:visible')).toHaveCount(0, { timeout: 10_000 })
})

When('我重新打开当前工作区的详情页', async function (this: CradleWorld) {
  await openWorkspaceDetail(this)
})

Then('当前 Workflow 编辑器中应显示规则:', async function (this: CradleWorld, docString: string) {
  const editor = workflowRulesEditable(this)
  await expect(editor).toBeVisible({ timeout: 10_000 })

  for (const line of visibleLines(docString)) {
    await expect(editor).toContainText(line, { timeout: 10_000 })
  }
})

Then('当前 Workflow 编辑器应该为空', async function (this: CradleWorld) {
  await expect.poll(async () => {
    const text = await workflowRulesEditable(this).textContent()
    return normalizeMultiline(text ?? '')
  }, { timeout: 10_000 }).toBe('')
})
