import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import {
  fillPromptEditor,
  newChatSendButton,
  newChatTextBox,
  visibleChatView,
  visibleProviderModelSelector,
  visibleRuntimeSelector,
  waitForNewChatReady,
} from '../support/ui'
import type { CradleWorld } from '../support/world'

const APPROVAL_TIMEOUT = 20_000
const MOCK_CLAUDE_AGENT_RE = /Mock Claude Agent/i

function claudeAgentMockBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '')
}

async function selectClaudeAgentRuntime(world: CradleWorld): Promise<void> {
  const runtimeSelector = visibleRuntimeSelector(world)
  await expect(runtimeSelector).toBeVisible({ timeout: 10_000 })
  await runtimeSelector.click()

  const menuPopup = world.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: 10_000 })
  await menuPopup.locator('[role="menuitem"]', { hasText: 'Claude Agent' }).click()
}

async function selectMockClaudeAgentProvider(world: CradleWorld): Promise<void> {
  const providerSelector = visibleProviderModelSelector(world)
  await expect(providerSelector).toBeVisible({ timeout: 10_000 })
  await providerSelector.click()

  const menuPopup = world.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: 10_000 })
  const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_CLAUDE_AGENT_RE }).first()
  await expect(mockItem).toBeVisible({ timeout: 10_000 })
  await mockItem.click()
  await world.page.keyboard.press('Escape')
}

Given('已创建一个需要审批的会话', async function (this: CradleWorld) {
  // Configure an Anthropic profile for the claude-agent runtime mock.
  if (this.mockLlmServer) {
    await this.mockLlmServer.stop()
  }

  const mockLlmServer = new MockLlmServer({ chunkDelay: 5, claudeAgentScenario: 'approval-tool' })
  this.mockLlmServer = mockLlmServer
  this.mockLlmBaseUrl = await mockLlmServer.start()
  const claudeAgentBaseUrl = claudeAgentMockBaseUrl(this.mockLlmBaseUrl)

  const response = await fetch(`${this.params.serverUrl}/profiles/mock-claude-agent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Mock Claude Agent',
      providerKind: 'anthropic',
      enabled: true,
      config: {
        baseUrl: claudeAgentBaseUrl,
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'default',
      },
      credentialRef: null,
    }),
  })
  if (!response.ok) {
    throw new Error(`Failed to configure claude-agent provider: ${response.status} ${await response.text()}`)
  }

  // Also provide a fake API key via secrets or env (the provider reads ANTHROPIC_API_KEY)
  // The mock server doesn't validate auth, so any key works
  // The provider resolves apiKey from profile config or env; we set it in config
  const credentialResponse = await fetch(`${this.params.serverUrl}/profiles/mock-claude-agent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Mock Claude Agent',
      providerKind: 'anthropic',
      enabled: true,
      config: {
        baseUrl: claudeAgentBaseUrl,
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'default',
        apiKey: 'sk-mock-test-key',
      },
      credentialRef: null,
    }),
  })
  if (!credentialResponse.ok) {
    throw new Error(`Failed to configure claude-agent credentials: ${credentialResponse.status} ${await credentialResponse.text()}`)
  }

  // Ensure workspace exists
  await this.ensureWorkspaceExists()

  // Reload to pick up fresh data
  await this.page.reload({ waitUntil: 'domcontentloaded' })

  // Navigate to new chat
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  const entry = await waitForNewChatReady(this)

  await selectClaudeAgentRuntime(this)
  await selectMockClaudeAgentProvider(this)

  // Fill and send
  await fillPromptEditor(newChatTextBox(entry), '请执行 echo hello')
  const sendBtn = newChatSendButton(entry)
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 })
  await sendBtn.click()

  // Wait for chat view to appear (the agent is now running and should hit canUseTool)
  const chatView = visibleChatView(this)
  await expect(chatView).toBeVisible({ timeout: 20_000 })
})

When('审批卡片出现', async function (this: CradleWorld) {
  const card = this.page.locator('[data-testid="approval-card"]')
  await expect(card).toBeVisible({ timeout: APPROVAL_TIMEOUT })
})

When('我点击"允许"按钮', async function (this: CradleWorld) {
  const btn = this.page.locator('[data-testid="approval-allow-btn"]')
  await expect(btn).toBeVisible({ timeout: 10_000 })
  await btn.click()
})

When('我点击"拒绝"按钮', async function (this: CradleWorld) {
  const btn = this.page.locator('[data-testid="approval-deny-btn"]')
  await expect(btn).toBeVisible({ timeout: 10_000 })
  await btn.click()
})

Then('审批卡片应该消失', async function (this: CradleWorld) {
  const card = this.page.locator('[data-testid="approval-card"]')
  await expect(card).toBeHidden({ timeout: APPROVAL_TIMEOUT })
})

Then('Agent 应该继续执行', async function (this: CradleWorld) {
  // After approval, the chat should return to idle status (agent completed execution)
  const chatView = visibleChatView(this)
  await expect(chatView).toHaveAttribute('data-chat-status', 'idle', { timeout: 30_000 })
})
