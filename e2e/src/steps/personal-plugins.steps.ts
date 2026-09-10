import { Given, Then, When } from '@cucumber/cucumber'

import { configurePersonalPluginLifecycleSimulator } from '../support/helpers/personal-plugin-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置 Claude Agent 个人 Plugin 生命周期 Simulator', async function (this: CradleWorld) {
  await configurePersonalPluginLifecycleSimulator(this)
})

When('我在聊天输入框中发送{string}', async function (this: CradleWorld, text: string) {
  await this.chat.fillAndSend(text)
})

Then('原始聊天应显示个人 Plugin 权限审查', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalReview()
})

Then('原始聊天应再次显示个人 Plugin 权限审查', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalReview()
})

Then('原始聊天不应再显示个人 Plugin 权限审查', async function (this: CradleWorld) {
  await this.pluginsPage.expectNoPersonalReview()
})

Then('个人 Plugin 应安装为未授权的不可变 v1 快照', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalSnapshotInstalled()
})

When('我在原始聊天中审查并激活个人 Plugin', async function (this: CradleWorld) {
  await this.pluginsPage.reviewAndActivatePersonalPlugin()
})

When('我返回个人 Plugin 的原始聊天', async function (this: CradleWorld) {
  await this.pluginsPage.returnToOriginatingChat()
})

Then('个人 Plugin v1 面板应可见', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalPanel('v1')
})

Then('个人 Plugin v2 面板应可见', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalPanel('v2')
})

Then('个人 Plugin 面板应不可见', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalPanelUnavailable()
})

Then('个人 Plugin v1 应记录精确权限授权', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalPluginGranted('v1')
})

Then('个人 Plugin v2 应记录精确权限授权', async function (this: CradleWorld) {
  await this.pluginsPage.expectPersonalPluginGranted('v2')
})

Then('个人 Plugin v1 快照与授权应保持不变', async function (this: CradleWorld) {
  await this.pluginsPage.expectFailedUpdatePreserved()
})

Then('个人 Plugin 新快照应替换 v1 并撤销旧授权', async function (this: CradleWorld) {
  await this.pluginsPage.expectUpdatedSnapshotPendingReview()
})
