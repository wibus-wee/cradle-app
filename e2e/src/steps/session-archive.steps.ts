import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

When('我归档当前会话{string}', async function (this: CradleWorld, title: string) {
  await this.sessionArchivePage.archiveCurrent(title)
})

Then('侧栏中不应显示恢复目标会话', async function (this: CradleWorld) {
  await this.sessionArchivePage.expectAbsentFromSidebar()
})

Then('我应该看到 Chat 设置页面', async function (this: CradleWorld) {
  await this.sessionArchivePage.expectReady()
})

Then('已归档会话中应显示恢复目标会话{string}', async function (this: CradleWorld, title: string) {
  await this.sessionArchivePage.expectArchived(title)
})

When('我搜索已归档会话{string}', async function (this: CradleWorld, query: string) {
  await this.sessionArchivePage.search(query)
})

Then('已归档会话应显示无匹配结果', async function (this: CradleWorld) {
  await this.sessionArchivePage.expectNoMatches()
})

When('我恢复目标会话{string}', async function (this: CradleWorld, title: string) {
  await this.sessionArchivePage.restore(title)
})

Then('已归档会话应为空', async function (this: CradleWorld) {
  await this.sessionArchivePage.expectEmpty()
})

Then('侧栏应显示恢复目标会话', async function (this: CradleWorld) {
  await this.sessionArchivePage.expectRestoredInSidebar()
})

When('我从侧栏打开恢复目标会话', async function (this: CradleWorld) {
  await this.sessionArchivePage.openRestored()
})
