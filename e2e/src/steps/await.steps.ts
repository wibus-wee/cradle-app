import { Given, Then, When } from '@cucumber/cucumber'

import {
  configureAwaitClaudeAgentSimulator,
  enqueueNextScriptedReply,
  recallSessionAlias,
} from '../support/helpers/chat-scenario'
import type { CradleWorld } from '../support/world'

const AWAIT_ID_KEY = 'await.id'

Given('我已配置 Await 恢复 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureAwaitClaudeAgentSimulator(this)
})

When('我为会话{string}注册永不自动触发的 JavaScript Await', async function (this: CradleWorld, alias: string) {
  const session = recallSessionAlias(this, alias)
  this.remember(AWAIT_ID_KEY, await this.awaitPage.register(session.id, 'E2E external condition'))
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
