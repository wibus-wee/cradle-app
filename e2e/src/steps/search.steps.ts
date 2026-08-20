import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { visibleChatView } from '../support/ui'
import type { CradleWorld } from '../support/world'

const GLOBAL_SEARCH_TIMEOUT = 15_000
const SESSION_ALIASES_KEY = 'chat.session-aliases'

type SessionAlias = {
  id: string
  firstUserText: string
}

function recallSessionAlias(world: CradleWorld, alias: string): SessionAlias {
  const aliases = world.maybeRecall<Record<string, SessionAlias>>(SESSION_ALIASES_KEY) ?? {}
  const session = aliases[alias]
  if (!session) {
    throw new Error(`Missing remembered chat session alias: ${alias}`)
  }
  return session
}

When('我打开全局搜索对话框', async function (this: CradleWorld) {
  await this.search.open()
})

When('我在全局搜索中输入{string}', async function (this: CradleWorld, query: string) {
  console.warn(`[step] type global search query: ${query}`)
  await this.search.fill(query)
})

When('我从全局搜索执行命令{string}', async function (this: CradleWorld, label: string) {
  console.warn(`[step] run global search command: ${label}`)
  await this.search.runCommand(label)
})

When('我按下 Escape 关闭全局搜索', async function (this: CradleWorld) {
  console.warn('[step] close global search with Escape')
  await expect(this.search.input()).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await this.page.keyboard.press('Escape')
})

Then('全局搜索命令{string}应可见', async function (this: CradleWorld, label: string) {
  console.warn(`[step] assert global search command visible: ${label}`)
  await this.search.expectCommandVisible(label)
})

Then('全局搜索对话框应关闭', async function (this: CradleWorld) {
  console.warn('[step] assert global search dialog closed')
  await expect(this.search.input()).toBeHidden({ timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('全局搜索中应该显示会话{string}的标题高亮{string}', async function (this: CradleWorld, alias: string, query: string) {
  console.warn(`[step] assert global search title highlight for alias: ${alias}`)
  const session = recallSessionAlias(this, alias)
  await this.search.expectThreadTitleHighlight(session.id, query)
})

When('我从全局搜索打开会话{string}', async function (this: CradleWorld, alias: string) {
  console.warn(`[step] open chat session from global search: ${alias}`)
  const session = recallSessionAlias(this, alias)
  await this.search.openThread(session.id)
})

Then('当前聊天视图应该打开会话{string}', async function (this: CradleWorld, alias: string) {
  const session = recallSessionAlias(this, alias)
  const chatView = visibleChatView(this)
  await expect(chatView).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(chatView).toHaveAttribute('data-chat-session-id', session.id, { timeout: GLOBAL_SEARCH_TIMEOUT })
})
