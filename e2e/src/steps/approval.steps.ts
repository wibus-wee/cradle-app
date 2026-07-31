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
  await expect(this.approval.card()).toContainText(text, { timeout: 10_000 })
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
