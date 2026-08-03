import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const APPROVAL_TIMEOUT = 30_000

When('审批卡片出现', async function (this: CradleWorld) {
  await this.approval.waitVisible(APPROVAL_TIMEOUT)
})

When('我点击"允许"按钮', async function (this: CradleWorld) {
  // Just-in-time enqueue the post-approval completion so intermediate Claude
  // Agent /v1/messages traffic cannot consume it before the user continues.
  if (this.simulator) {
    const { anthropicTextExchange, anthropicScenario } = await import('../support/scenarios/anthropic')
    this.enqueue(anthropicScenario([
      anthropicTextExchange({
        label: `approval-complete-${Date.now()}`,
        text: 'Approved. The command execution plan completed.',
        bodyTextExcludes: 'You are naming a Claude Agent task session',
      }),
    ]))
  }
  await this.approval.allow()
})

When('我点击"拒绝"按钮', async function (this: CradleWorld) {
  await this.approval.deny()
})

Then('审批卡片应该消失', async function (this: CradleWorld) {
  await this.approval.expectHidden(APPROVAL_TIMEOUT)
})

Then('审批卡片应包含{string}', async function (this: CradleWorld, text: string) {
  await this.approval.expectContains(text)
})

Then('计划实施审批应为已拒绝', async function (this: CradleWorld) {
  const planApproval = this.page.locator('[data-testid="chat-tool-call-implement-plan:toolu_e2e_plan_approval"]')
  await expect(planApproval).toBeVisible({ timeout: APPROVAL_TIMEOUT })
  await expect(planApproval).toHaveAttribute('data-approval-approved', 'false', { timeout: APPROVAL_TIMEOUT })
  // Status text lives on the status icon title (not always in innerText).
  await expect(planApproval.locator('[title*="Denied"]')).toBeVisible({ timeout: APPROVAL_TIMEOUT })
})

Then('计划实施审批应为已批准', async function (this: CradleWorld) {
  const planApproval = this.page.locator('[data-testid="chat-tool-call-implement-plan:toolu_e2e_plan_approval"]')
  await expect(planApproval).toBeVisible({ timeout: APPROVAL_TIMEOUT })
  await expect(planApproval).toHaveAttribute('data-approval-approved', 'true', { timeout: APPROVAL_TIMEOUT })
  await expect(planApproval.locator('[title*="Approved"]')).toBeVisible({ timeout: APPROVAL_TIMEOUT })
})

Then('聊天中不应出现审批通过后的完成回复', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="chat-view"]').first())
    .not
    .toContainText('Approved. The command execution plan completed.', { timeout: 5_000 })
})

// Legacy step kept for archived features; essence suite uses Claude Agent 审批 Simulator.
Given('已创建一个需要审批的会话', async function (this: CradleWorld) {
  await this.configureClaudeAgentChat({ mode: 'approval' })
  await this.newChat.openFromNav()
  await this.newChat.selectRuntime('Claude Agent')
  await this.newChat.selectProvider(/E2E Claude Agent/i)
  await this.newChat.fill('请准备需要审批的计划')
  await this.newChat.send()
  await expect(this.chat.view()).toBeVisible({ timeout: 20_000 })
})
