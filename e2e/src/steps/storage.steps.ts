import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  configureStorageLifecycleCodexSimulator,
  createRememberedSession,
  recallSessionAlias,
  releaseStorageActiveGate,
  startRememberedStreamingSession,
  STORAGE_ACTIVE_RESPONSE,
} from '../support/helpers/chat-scenario'
import { StoragePage } from '../support/pages/storage'
import type { CradleWorld } from '../support/world'

function storage(world: CradleWorld): StoragePage {
  return new StoragePage(world.page)
}

Given('我已为存储生命周期配置 Codex Simulator', async function (this: CradleWorld) {
  await configureStorageLifecycleCodexSimulator(this)
})

Given('我已创建可清理会话{string}', async function (this: CradleWorld, alias: string) {
  await createRememberedSession(this, alias, '创建可清理会话')
})

Given('我已启动活动会话{string}', async function (this: CradleWorld, alias: string) {
  await startRememberedStreamingSession(this, alias, '保持活动以验证存储保护')
})

When('我打开 Storage 设置页面', async function (this: CradleWorld) {
  await this.search.open()
  await this.search.fill('>settings')
  await this.search.runCommand('Open settings')
  const navItem = this.page.locator('[data-testid="settings-nav-storage"]')
  await expect(navItem).toBeVisible({ timeout: 10_000 })
  await navItem.click()
  await storage(this).expectVisible()
})

Then('Storage 中的会话{string}应有 {int} 条消息', async function (this: CradleWorld, alias: string, count: number) {
  await storage(this).expectSession(recallSessionAlias(this, alias).id, count)
})

Then('Storage 应保护活动会话{string}', async function (this: CradleWorld, alias: string) {
  await storage(this).expectActiveProtected(recallSessionAlias(this, alias).id)
})

When('我清空会话{string}的 transcript', async function (this: CradleWorld, alias: string) {
  await storage(this).clearTranscript(recallSessionAlias(this, alias).id)
})

When('我从 Storage 删除会话{string}', async function (this: CradleWorld, alias: string) {
  await storage(this).deleteSession(recallSessionAlias(this, alias).id)
})

Then('Storage 中不应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await expect(storage(this).session(recallSessionAlias(this, alias).id)).toHaveCount(0, { timeout: 15_000 })
})

Then('侧栏中应删除会话{string}', async function (this: CradleWorld, alias: string) {
  await expect(this.chat.sessionItem(recallSessionAlias(this, alias).id)).toHaveCount(0, { timeout: 15_000 })
})

When('我释放存储旅程的活动会话', async function (this: CradleWorld) {
  await releaseStorageActiveGate(this)
})

Then('活动会话{string}应完成且不受清理影响', async function (this: CradleWorld, alias: string) {
  await this.chat.sessionItem(recallSessionAlias(this, alias).id).click()
  await this.chat.expectAssistantContains(STORAGE_ACTIVE_RESPONSE, 30_000)
  await this.chat.expectNoError()
})
