import { Then, When } from '@cucumber/cucumber'

import { recallSessionAlias } from '../support/helpers/chat-scenario'
import type { CradleWorld } from '../support/world'

When('我使用已打开的会话菜单创建会话组{string}', async function (this: CradleWorld, title: string) {
  await this.sessionGroupsPage.createFromOpenSessionMenu(title)
})

Then('会话组{string}应折叠并显示 {int} 个成员', async function (
  this: CradleWorld,
  title: string,
  sessionCount: number,
) {
  await this.sessionGroupsPage.expectCollapsed(title, sessionCount)
})

When('我展开会话组{string}', async function (this: CradleWorld, title: string) {
  await this.sessionGroupsPage.expand(title)
})

Then('会话组{string}应展开并显示会话{string}及 {int} 个成员', async function (
  this: CradleWorld,
  title: string,
  alias: string,
  sessionCount: number,
) {
  await this.sessionGroupsPage.expectExpandedWithMember(
    title,
    recallSessionAlias(this, alias).id,
    sessionCount,
  )
})

When('我将会话组{string}重命名为{string}', async function (
  this: CradleWorld,
  currentTitle: string,
  nextTitle: string,
) {
  await this.sessionGroupsPage.rename(currentTitle, nextTitle)
})

When('我删除会话组{string}', async function (this: CradleWorld, title: string) {
  await this.sessionGroupsPage.remove(title)
})

Then('侧栏中不应显示会话组{string}', async function (this: CradleWorld, title: string) {
  await this.sessionGroupsPage.expectAbsent(title)
})

Then('会话{string}应显示在未分组列表中', async function (this: CradleWorld, alias: string) {
  await this.sessionGroupsPage.expectSessionUngrouped(recallSessionAlias(this, alias).id)
})

When('我从侧栏打开会话{string}', async function (this: CradleWorld, alias: string) {
  await this.chat.openSession(recallSessionAlias(this, alias).id)
})
