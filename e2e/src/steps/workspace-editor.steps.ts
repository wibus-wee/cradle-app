import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

When('我从工作区文件树打开文件{string}', async function (this: CradleWorld, relativePath: string) {
  await this.workspaceEditorPage.openFile(relativePath)
})

Then('工作区内置编辑器应打开文件{string}', async function (this: CradleWorld, relativePath: string) {
  await this.workspaceEditorPage.expectFileOpen(relativePath)
})

Then('工作区内置编辑器应显示内容{string}', async function (this: CradleWorld, content: string) {
  await this.workspaceEditorPage.expectContent(content)
})

Then('工作区内置编辑器状态应为{string}', async function (this: CradleWorld, status: string) {
  await this.workspaceEditorPage.expectStatus(status)
})

When('我将工作区内置编辑器内容替换为{string}', async function (this: CradleWorld, content: string) {
  await this.workspaceEditorPage.replaceContent(content)
})

When('我保存工作区内置编辑器中的文件{string}', async function (
  this: CradleWorld,
  relativePath: string,
) {
  await this.workspaceEditorPage.save(relativePath)
})

Then('当前工作区文件{string}的磁盘内容应为{string}', function (
  this: CradleWorld,
  relativePath: string,
  content: string,
) {
  this.workspaceEditorPage.expectDiskContent(relativePath, content)
})
