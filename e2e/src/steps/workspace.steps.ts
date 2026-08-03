import { Given, Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

Then('我应该看到工作区列表为空', async function (this: CradleWorld) {
  await this.workspacePage.expectListEmpty()
})

Then('我应该看到"添加工作区"按钮', async function (this: CradleWorld) {
  await this.workspacePage.expectAddWorkspaceButtonVisible()
})

When('我通过原生对话框添加工作区', async function (this: CradleWorld) {
  await this.workspacePage.addWorkspaceThroughNativeDialog()
})

Then('工作区列表中应该有 {int} 个工作区', async function (this: CradleWorld, count: number) {
  await this.workspacePage.expectWorkspaceListCount(count)
})

Given('我已添加了一个工作区', async function (this: CradleWorld) {
  await this.workspacePage.ensureOneWorkspaceAdded()
})

When('我打开该工作区的菜单', async function (this: CradleWorld) {
  await this.workspacePage.openCurrentWorkspaceMenu()
})

When('我点击"移除工作区"', async function (this: CradleWorld) {
  await this.workspacePage.removeWorkspaceFromMenu()
})

Given('我已通过 API 添加了一个工作区', async function (this: CradleWorld) {
  await this.workspacePage.addApiWorkspace()
})

Given('我已通过 API 添加了一个包含 AGENTS.md 的工作区', async function (this: CradleWorld) {
  await this.workspacePage.addApiWorkspaceWithAgentsFile()
})

Given('我已添加了一个包含 AGENTS.md 的工作区', async function (this: CradleWorld) {
  await this.workspacePage.addWorkspaceWithAgentsFromPicker()
})

Given('当前工作区中存在文件{string}，内容为{string}', function (
  this: CradleWorld,
  relativePath: string,
  content: string,
) {
  this.workspacePage.writeFileInCurrentWorkspace(relativePath, content)
})

When('我在新建聊天中选择当前工作区', async function (this: CradleWorld) {
  await this.workspacePage.selectCurrentWorkspaceInNewChat()
})

Given('我已通过 API 添加了两个可区分的工作区', async function (this: CradleWorld) {
  await this.workspacePage.addDistinguishableWorkspacesViaApi()
})

Given('我已添加了两个可区分的工作区', async function (this: CradleWorld) {
  await this.workspacePage.addDistinguishableWorkspacesFromPicker()
})

When('我打开当前工作区的详情页', async function (this: CradleWorld) {
  await this.workspacePage.openCurrentWorkspaceDetail()
})

When('我打开第 {int} 个工作区的详情页', async function (this: CradleWorld, ordinal: number) {
  await this.workspacePage.openWorkspaceDetailByOrdinal(ordinal)
})

When('我将工作区重命名为 {string}', async function (this: CradleWorld, nextName: string) {
  await this.workspacePage.renameCurrentWorkspace(nextName)
})

When('我在工作区详情页输入任务{string}', async function (this: CradleWorld, text: string) {
  await this.workspacePage.fillDetailTask(text)
})

When('我从工作区详情页发送任务', async function (this: CradleWorld) {
  await this.workspacePage.sendDetailTask()
})

Then('工作区详情页标题应该是 {string}', async function (this: CradleWorld, expectedName: string) {
  await this.workspacePage.expectDetailTitle(expectedName)
})

Then('当前工作区详情页应该打开', async function (this: CradleWorld) {
  await this.workspacePage.expectCurrentDetailOpen()
})

Then('工作区列表中应该包含工作区 {string}', async function (this: CradleWorld, workspaceName: string) {
  await this.workspacePage.expectWorkspaceListContains(workspaceName)
})

Then('工作区列表中应该包含这 {int} 个工作区', async function (this: CradleWorld, count: number) {
  await this.workspacePage.expectRememberedWorkspacesVisible(count)
})

Then('工作区详情页应该显示第 {int} 个工作区的真实内容', async function (this: CradleWorld, ordinal: number) {
  await this.workspacePage.expectDetailContentForOrdinal(ordinal)
})

Then('我应该看到工作区详情页的标签页', async function (this: CradleWorld) {
  await this.workspacePage.expectDetailTabsVisible()
})

Then('Overview 应该显示当前工作区的 AGENTS.md 内容', async function (this: CradleWorld) {
  await this.workspacePage.expectCurrentDetailContent()
})

Then('工作区详情页最近会话应显示{string}', async function (this: CradleWorld, title: string) {
  await this.workspacePage.expectRecentSessionTitle(title)
})
