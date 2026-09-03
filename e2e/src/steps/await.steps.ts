import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  configureAwaitClaudeAgentSimulator,
  configureTerminalAwaitClaudeAgentSimulator,
  enqueueNextScriptedReply,
  recallSessionAlias,
} from '../support/helpers/chat-scenario'
import { restartManagedServer } from '../support/server-lifecycle'
import type { CradleWorld } from '../support/world'

const AWAIT_ID_KEY = 'await.id'
const CANCELLED_AWAIT_ID_KEY = 'await.cancelled-id'
const EXPIRED_AWAIT_ID_KEY = 'await.expired-id'

Given('我已配置 Await 恢复 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureAwaitClaudeAgentSimulator(this)
})

Given('我已配置 Await 终态 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureTerminalAwaitClaudeAgentSimulator(this)
})

When('我为会话{string}注册永不自动触发的 JavaScript Await', async function (this: CradleWorld, alias: string) {
  const session = recallSessionAlias(this, alias)
  this.remember(AWAIT_ID_KEY, await this.awaitPage.register(session.id, 'E2E external condition'))
})

When('我为会话{string}注册可取消的 JavaScript Await', async function (this: CradleWorld, alias: string) {
  const session = recallSessionAlias(this, alias)
  const id = await this.awaitPage.register(session.id, 'E2E cancellable condition')
  this.remember(CANCELLED_AWAIT_ID_KEY, id)
})

When('我为会话{string}注册已经超时的 JavaScript Await', async function (this: CradleWorld, alias: string) {
  const session = recallSessionAlias(this, alias)
  const id = await this.awaitPage.register(session.id, 'E2E expired condition', {
    expiresAt: Math.floor(Date.now() / 1000) - 1,
  })
  this.remember(EXPIRED_AWAIT_ID_KEY, id)
  await this.awaitPage.expectServerStatus(id, 'expired')
})

When('我打开会话 Await 面板', async function (this: CradleWorld) {
  await this.awaitPage.open()
})

Then('Await 面板应显示 pending 条件{string}', async function (this: CradleWorld, reason: string) {
  await this.awaitPage.expectStatus('pending', reason)
})

Then('Await 面板应仍显示 pending 条件{string}', async function (this: CradleWorld, reason: string) {
  await this.awaitPage.expectStatus('pending', reason)
})

When('我在 Await 面板取消条件{string}', async function (this: CradleWorld, reason: string) {
  await this.awaitPage.cancel(reason)
})

Then('Await 面板应显示条件{string}为 cancelled', async function (this: CradleWorld, reason: string) {
  await this.awaitPage.expectStatus('cancelled', reason)
})

Then('Await 面板应显示条件{string}为 expired', async function (this: CradleWorld, reason: string) {
  await this.awaitPage.expectStatus('expired', reason)
})

When('Cradle Server 在 Await 终态后崩溃并使用原数据目录重启', async function (this: CradleWorld) {
  await restartManagedServer()
  await this.page.reload({ waitUntil: 'domcontentloaded' })
  await expect(this.page.locator('[data-testid="app-sidebar"]')).toBeVisible({ timeout: 30_000 })
})

When('迟到的外部条件尝试解析已取消和已超时的 Await', async function (this: CradleWorld) {
  await this.awaitPage.expectTriggerRejected(
    this.recall<string>(CANCELLED_AWAIT_ID_KEY),
    'E2E cancelled await late resolution',
  )
  await this.awaitPage.expectTriggerRejected(
    this.recall<string>(EXPIRED_AWAIT_ID_KEY),
    'E2E expired await late resolution',
  )
})

Then('Await 终态服务端应仍为 cancelled 和 expired', async function (this: CradleWorld) {
  await this.awaitPage.expectServerStatus(this.recall<string>(CANCELLED_AWAIT_ID_KEY), 'cancelled')
  await this.awaitPage.expectServerStatus(this.recall<string>(EXPIRED_AWAIT_ID_KEY), 'expired')
})

When('外部条件触发 Await 并恢复文本{string}', async function (this: CradleWorld, resumeText: string) {
  await enqueueNextScriptedReply(this, 'Await 恢复后的真实回复')
  await this.awaitPage.trigger(this.recall<string>(AWAIT_ID_KEY), resumeText)
})

Then('Await 面板应显示 triggered 状态', async function (this: CradleWorld) {
  await this.awaitPage.expectStatus('triggered')
})

Then('Await 服务端状态应为 triggered', async function (this: CradleWorld) {
  await this.awaitPage.expectServerStatus(this.recall<string>(AWAIT_ID_KEY), 'triggered')
})
