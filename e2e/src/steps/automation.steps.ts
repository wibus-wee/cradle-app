import { Given, Then, When } from '@cucumber/cucumber'

import { AUTOMATION_REPORT, AUTOMATION_SUMMARY, AutomationPage } from '../support/pages/automation'
import type { CradleWorld } from '../support/world'

function automation(world: CradleWorld): AutomationPage {
  return new AutomationPage(world)
}

Given('我已配置 Automation 报告 Claude Agent Simulator', async function (this: CradleWorld) {
  await this.configureClaudeAgentChat({
    text: `${AUTOMATION_REPORT}\n\nCRADLE_AUTOMATION_RESULT: findings | ${AUTOMATION_SUMMARY}`,
  })
})

Given('当前工作区已有一个 Automation 定义', async function (this: CradleWorld) {
  await automation(this).seedDefinition()
})

When('我打开 Automations 页面并选中该定义', async function (this: CradleWorld) {
  await automation(this).openAndSelectDefinition()
})

When('我手动运行该 Automation', async function (this: CradleWorld) {
  await automation(this).runNow()
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
