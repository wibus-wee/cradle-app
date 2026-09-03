import { Given, Then, When } from '@cucumber/cucumber'

import { createExternalClaudeSessionFixture } from '../support/helpers/external-session-import-scenario'
import type { CradleWorld } from '../support/world'

Given('本机存在一段可导入的外部 Claude 会话历史', function (this: CradleWorld) {
  createExternalClaudeSessionFixture(this)
})

When('我从 Import 设置扫描外部会话', async function (this: CradleWorld) {
  await this.externalSessionImportPage.open()
  await this.externalSessionImportPage.scan()
})

When('我选择并导入该 Claude 会话', async function (this: CradleWorld) {
  await this.externalSessionImportPage.importCandidate()
})

Then('我可以从导入结果打开完整会话', async function (this: CradleWorld) {
  await this.externalSessionImportPage.openImportedSession()
})

Then('刷新后导入的会话与消息应保持不变', async function (this: CradleWorld) {
  await this.externalSessionImportPage.expectPersistedTranscript()
})

Then('重新扫描应阻止重复导入且不修改外部源文件', async function (this: CradleWorld) {
  await this.externalSessionImportPage.expectIdempotentSourceOwnership()
})
