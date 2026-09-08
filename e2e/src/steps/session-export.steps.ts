import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

When('我从当前会话菜单导出 ZIP', async function (this: CradleWorld) {
  await this.sessionExportPage.exportCurrentSession()
})

When('我将当前会话重命名为{string}', async function (this: CradleWorld, title: string) {
  await this.sessionExportPage.renameCurrentSession(title)
})

Then('下载的会话 ZIP 应匹配当前会话身份和确定性文件名', function (this: CradleWorld) {
  this.sessionExportPage.expectArchiveIdentity()
})

Then('下载的会话 ZIP 应只包含完整 JSON 与 Markdown 记录', function (this: CradleWorld) {
  this.sessionExportPage.expectArchiveContents()
})

Then('导出后当前会话和消息应保持不变', async function (this: CradleWorld) {
  await this.sessionExportPage.expectCurrentSessionUnchanged()
})
