import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

Then('Runtimes 设置页面应已就绪', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectReady()
})

When('我开始添加本地 ACP Runtime', async function (this: CradleWorld) {
  await this.agentRuntimesPage.startAddingLocalAgent()
})

When('我输入包含无效环境变量行的本地 ACP 配置', async function (this: CradleWorld) {
  await this.agentRuntimesPage.enterInvalidConfig()
})

Then('本地 ACP 配置应指出第 2 行无效且无法保存', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectInvalidEnvironment()
})

When('我修正环境变量并保存本地 ACP Runtime', async function (this: CradleWorld) {
  await this.agentRuntimesPage.correctEnvironmentAndCreate()
})

Then('本地 ACP Runtime 应以规范化配置创建成功', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectCreated()
})

When('我选择已创建的本地 ACP Runtime', async function (this: CradleWorld) {
  await this.agentRuntimesPage.selectCreated()
})

Then('本地 ACP Runtime 应恢复已保存的规范化配置', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectInitialConfig()
})

When('我更新并保存本地 ACP Runtime 配置', async function (this: CradleWorld) {
  await this.agentRuntimesPage.updateConfig()
})

Then('本地 ACP Runtime 应显示更新成功', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectUpdated()
})

When('我选择已更新的本地 ACP Runtime', async function (this: CradleWorld) {
  await this.agentRuntimesPage.selectUpdated()
})

Then('本地 ACP Runtime 应恢复更新后的配置', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectUpdatedConfig()
})

When('我删除本地 ACP Runtime', async function (this: CradleWorld) {
  await this.agentRuntimesPage.deleteAgent()
})

Then('本地 ACP Runtime 应从列表中移除', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectDeleted(true)
})

Then('本地 ACP Runtime 应保持已删除状态', async function (this: CradleWorld) {
  await this.agentRuntimesPage.expectDeleted(false)
})
