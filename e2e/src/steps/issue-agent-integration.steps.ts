import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const DELEGATE_TRIGGER = '[data-testid="issue-agent-trigger"]'
const DELEGATE_OPTIONS = '[data-testid^="issue-agent-option-"]'
const AGENT_SESSION = '[data-testid="issue-agent-session"]'
const AGENT_SESSION_PHASE = '[data-testid="issue-agent-session-phase"]'
const AGENT_SESSION_OPEN_CHAT = '[data-testid="issue-agent-session-open-chat"]'
const AGENT_SESSION_RERUN = '[data-testid="issue-agent-rerun-btn"]'
const ISSUE_ACTIVITY_TIMELINE = '[data-testid="issue-activity-timeline"]'

async function selectAgentForCurrentIssue(world: CradleWorld, agentName: string): Promise<void> {
  const trigger = world.page.locator(DELEGATE_TRIGGER)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = world.page.locator(DELEGATE_OPTIONS).filter({ hasText: agentName }).first()
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

async function waitForAgentSessionPhaseText(world: CradleWorld, expected: string): Promise<void> {
  const phase = world.page.locator(AGENT_SESSION_PHASE)
  await expect(phase).toBeVisible({ timeout: 10_000 })
  await expect(phase).toContainText(expected, { timeout: 30_000 })
}

When('我将当前 Issue 委派给{string}', async function (this: CradleWorld, agentName: string) {
  console.warn(`[step] delegate current issue to ${agentName}`)
  await selectAgentForCurrentIssue(this, agentName)
})

When('我重新运行当前 Issue 的 Agent 会话', async function (this: CradleWorld) {
  console.warn('[step] rerun current delegated issue agent session')
  const button = this.page.locator(AGENT_SESSION_RERUN)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
})

Then('当前 Issue 的 Agent 会话应出现在详情面板中', async function (this: CradleWorld) {
  await expect(this.page.locator(AGENT_SESSION)).toBeVisible({ timeout: 10_000 })
})

Then('当前 Issue 的 Agent 会话状态应显示{string}', async function (this: CradleWorld, expected: string) {
  await waitForAgentSessionPhaseText(this, expected)
})

Then('当前 Issue 的 Agent 会话应显示可重新运行', async function (this: CradleWorld) {
  await expect(this.page.locator(AGENT_SESSION_RERUN)).toBeVisible({ timeout: 30_000 })
})

Then('Activity 时间线应显示{string}', async function (this: CradleWorld, text: string) {
  await expect(this.page.locator(ISSUE_ACTIVITY_TIMELINE).locator(`text=${text}`)).toBeVisible({ timeout: 30_000 })
})

Then('我可以打开当前 Issue 的 Agent 聊天会话', async function (this: CradleWorld) {
  const button = this.page.locator(AGENT_SESSION_OPEN_CHAT)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(this.page.locator('[data-testid="chat-view"]')).toBeVisible({ timeout: 30_000 })
})

Given('我已将当前 Issue 委派给{string}', async function (this: CradleWorld, agentName: string) {
  await selectAgentForCurrentIssue(this, agentName)
  await waitForAgentSessionPhaseText(this, 'Done')
})

When('我取消当前 Issue 的 Agent 委派', async function (this: CradleWorld) {
  // Retry pattern: popover may close due to re-renders from session polling
  const maxRetries = 3
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const trigger = this.page.locator(DELEGATE_TRIGGER)
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()

    const unassignedOption = this.page.locator('[data-testid="issue-agent-option-none"]')
    try {
      await expect(unassignedOption).toBeVisible({ timeout: 5_000 })
      await unassignedOption.click({ timeout: 5_000 })
      return
    }
    catch {
      if (attempt === maxRetries - 1) {
        throw new Error('Failed to click unassigned option after retries')
      }
      await this.page.waitForTimeout(500)
    }
  }
})

Then('当前 Issue 不应再显示 Agent 委派', async function (this: CradleWorld) {
  const trigger = this.page.locator(DELEGATE_TRIGGER)
  await expect(trigger).toContainText('No agent', { timeout: 30_000 })
})
