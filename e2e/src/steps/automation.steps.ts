import { Given, Then, When } from '@cucumber/cucumber'

import {
  AUTOMATION_CANCELLED_REPLY,
  AUTOMATION_CANCELLED_SESSION_TITLE,
  configureCancelableAutomationSimulator,
  expectCancelableAutomationGateCanceled,
  waitForCancelableAutomationGate,
} from '../support/helpers/automation-scenario'
import {
  AUTOMATION_REPORT,
  AUTOMATION_SESSION_TITLE,
  AUTOMATION_SUMMARY,
  AutomationPage,
} from '../support/pages/automation'
import { anthropicTextExchange } from '../support/scenarios/anthropic'
import type { CradleWorld } from '../support/world'

function automation(world: CradleWorld): AutomationPage {
  return new AutomationPage(world)
}

Given('我已配置 Automation 报告 Claude Agent Simulator', async function (this: CradleWorld) {
  await this.configureClaudeAgentChat({
    text: `${AUTOMATION_REPORT}\n\nCRADLE_AUTOMATION_RESULT: findings | ${AUTOMATION_SUMMARY}`,
  })
  this.enqueueAnthropic(anthropicTextExchange({
    label: 'automation-session-title',
    text: AUTOMATION_SESSION_TITLE,
    bodyTextIncludes: 'You are naming a Claude Agent task session',
  }))
})

Given('当前工作区已有一个 Automation 定义', async function (this: CradleWorld) {
  await automation(this).seedDefinition()
})

Given('我已配置可取消的 Automation Claude Agent Simulator', async function (this: CradleWorld) {
  await configureCancelableAutomationSimulator(this)
})

When('我打开 Automations 页面并选中该定义', async function (this: CradleWorld) {
  await automation(this).openAndSelectDefinition()
})

When('我手动运行该 Automation', async function (this: CradleWorld) {
  await automation(this).runNow()
})

When('我启动该 Automation 并等待 Agent 响应进入门控', async function (this: CradleWorld) {
  await automation(this).startRun()
  await waitForCancelableAutomationGate(this)
  await automation(this).rememberRunningRun()
})

Then('重新加载后应显示可停止的 Automation 运行', async function (this: CradleWorld) {
  await automation(this).expectRunningRunAfterReload()
})

When('我停止该 Automation 运行', async function (this: CradleWorld) {
  await automation(this).stopRunningRun()
})

Then('Automation 应显示待审阅的已取消运行且没有产物', async function (this: CradleWorld) {
  await automation(this).expectCancelledRunInTriage()
})

Then('Automation 的已取消运行应在重载后保持一致', async function (this: CradleWorld) {
  await automation(this).expectPersistedCancelledRun()
})

When('我打开已取消 Automation 的关联会话', async function (this: CradleWorld) {
  await automation(this).openCancelledLinkedSession(AUTOMATION_CANCELLED_SESSION_TITLE)
})

Then('已取消 Automation 会话不应包含迟到回复', async function (this: CradleWorld) {
  await automation(this).expectCancelledSessionWithoutReply(AUTOMATION_CANCELLED_REPLY)
})

Then('已取消 Automation 的 Provider 门控应已取消', async function (this: CradleWorld) {
  await expectCancelableAutomationGateCanceled(this)
})

Then('Automation 应生成待审阅的成功运行', async function (this: CradleWorld) {
  await automation(this).expectCompletedRunInTriage()
})

Then('Automation 运行产物应包含 Agent 报告', async function (this: CradleWorld) {
  await automation(this).expectArtifact()
})

When('我将该 Automation 运行标记为已解决', async function (this: CradleWorld) {
  await automation(this).resolveRun()
})

Then('Automation Triage 应不再显示该运行', async function (this: CradleWorld) {
  await automation(this).expectTriageEmpty()
})

Then('Automation 的成功运行与产物应保持可见', async function (this: CradleWorld) {
  await automation(this).expectPersistedRunAndArtifact()
})

When('我从工作区侧栏打开 Automation 生成的会话', async function (this: CradleWorld) {
  await automation(this).openLinkedSession()
})

Then('Automation 会话应显示同一份 Agent 报告', async function (this: CradleWorld) {
  await automation(this).expectLinkedSessionReport()
})
