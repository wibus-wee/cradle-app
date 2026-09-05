import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

When('我从 npm 源预览并安装 E2E 可见面板插件', async function (this: CradleWorld) {
  await this.pluginsPage.openCenter()
  await this.pluginsPage.installFixture()
})

When('我审查信任并启用 E2E 可见面板插件', async function (this: CradleWorld) {
  await this.pluginsPage.trustAndEnableFixture()
})

When('我打开 E2E 插件贡献的面板', async function (this: CradleWorld) {
  await this.pluginsPage.openAndExpectPanel()
})

When('我在插件中心禁用 E2E 可见面板插件', async function (this: CradleWorld) {
  await this.pluginsPage.setFixtureEnabled(false)
})

When('我在插件中心重新启用 E2E 可见面板插件', async function (this: CradleWorld) {
  await this.pluginsPage.setFixtureEnabled(true)
})

Then('E2E 插件面板贡献应可见', async function (this: CradleWorld) {
  await this.pluginsPage.expectPanelAvailable()
})

Then('E2E 插件面板贡献应不可见', async function (this: CradleWorld) {
  await this.pluginsPage.expectPanelUnavailable()
})

Then('Server 应仅记录一个已启用的 E2E 可见面板插件', async function (this: CradleWorld) {
  await this.pluginsPage.expectServerState(true)
})

Then('Server 应仅记录一个已禁用的 E2E 可见面板插件', async function (this: CradleWorld) {
  await this.pluginsPage.expectServerState(false)
})
