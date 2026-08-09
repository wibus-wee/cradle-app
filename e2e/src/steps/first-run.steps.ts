import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { anthropicScenario, anthropicTextExchange } from '../support/scenarios/anthropic'
import type { CradleWorld } from '../support/world'

const FIRST_RUN_PROVIDER = 'E2E First Run Claude'

Given('我已为首次启动准备 Claude Agent Simulator', async function (this: CradleWorld) {
  const simulator = await this.ensureSimulator()
  simulator.reset()
  this.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'first-run-first-chat',
      text: '首次启动链路已完成',
      bodyTextIncludes: '首次启动后的第一条消息',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
})

Then('我应该看到品牌首次启动页', async function (this: CradleWorld) {
  await expect(this.firstRunPage.onboarding()).toBeVisible({ timeout: 30_000 })
})

When('我完成品牌首次启动页', async function (this: CradleWorld) {
  await this.firstRunPage.completeBrandOnboarding()
})

When('我在首次设置中创建 Simulator Provider', async function (this: CradleWorld) {
  const simulator = await this.ensureSimulator()
  await this.firstRunPage.createAnthropicProvider({
    name: FIRST_RUN_PROVIDER,
    baseUrl: simulator.anthropicBaseUrl,
    apiKey: 'sk-ant-e2e-first-run',
  })
})

When('我跳过 GitHub 并完成首次设置', async function (this: CradleWorld) {
  await this.firstRunPage.skipGithubAndFinish()
})

When('我选择首次启动创建的 Claude Agent Provider', async function (this: CradleWorld) {
  await this.newChat.selectRuntime('Claude Agent')
  await this.newChat.selectProvider(new RegExp(FIRST_RUN_PROVIDER, 'i'))
})

Then('首次启动设置应保持完成', async function (this: CradleWorld) {
  await expect(this.firstRunPage.onboarding()).toHaveCount(0)
  await expect(this.firstRunPage.setupDialog()).toHaveCount(0)
  await this.chat.expectUserMessage('首次启动后的第一条消息')
  await this.chat.expectAssistantContains('首次启动链路已完成')
})
