import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { visibleChatView } from '../support/ui'
import type { CradleWorld } from '../support/world'

const GLOBAL_SEARCH_TIMEOUT = 15_000
const SESSION_ALIASES_KEY = 'chat.session-aliases'

const COMMAND_LABEL_TO_ID: Record<string, string> = {
  打开设置: 'open-settings',
  用量统计: 'open-usage',
  切换侧栏: 'toggle-sidebar',
  新建对话: 'new-chat',
}

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

function globalSearchInput(world: CradleWorld) {
  return world.page.locator('[data-testid="global-search-input"]').filter({ visible: true }).last()
}

function threadResult(world: CradleWorld, sessionId: string) {
  return world.page.locator(`[data-testid="global-search-thread-result-${sessionId}"]`).filter({ visible: true }).last()
}

function commandId(label: string): string {
  const id = COMMAND_LABEL_TO_ID[label]
  if (!id) {
    throw new Error(`Unknown global search command label: ${label}`)
  }
  return id
}

function commandRow(world: CradleWorld, label: string) {
  return world.page.locator(`[data-testid="global-search-command-${commandId(label)}"]`).filter({ visible: true }).last()
}

function issueResult(world: CradleWorld, title: string) {
  return world.page.locator('[data-testid^="global-search-issue-result-"]').filter({ visible: true, hasText: title }).last()
}

function fileResult(world: CradleWorld, path: string) {
  return world.page.locator(`[data-testid="global-search-file-result-${path}"]`).filter({ visible: true }).last()
}

async function openGlobalSearch(world: CradleWorld): Promise<void> {
  console.warn('[step] open global search dialog')
  const searchButton = world.page.locator('[data-testid="nav-search"]')

  if (await searchButton.isVisible().catch(() => false)) {
    await searchButton.click()
  }
  else {
    await world.page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  }

  await expect(globalSearchInput(world)).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
}

async function getActiveChatView(world: CradleWorld) {
  const chatView = visibleChatView(world)
  await expect(chatView).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  return chatView
}

When('我打开全局搜索对话框', async function (this: CradleWorld) {
  await openGlobalSearch(this)
})

When('我在全局搜索中输入{string}', async function (this: CradleWorld, query: string) {
  console.warn(`[step] type global search query: ${query}`)
  const input = globalSearchInput(this)
  await expect(input).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await input.fill(query)
  // Wait for the search results to update
  await this.page.waitForTimeout(500)
})

When('我从全局搜索执行命令{string}', async function (this: CradleWorld, label: string) {
  console.warn(`[step] run global search command: ${label}`)
  const row = commandRow(this, label)

  await expect(row).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await row.click()
  await expect(globalSearchInput(this)).toBeHidden({ timeout: GLOBAL_SEARCH_TIMEOUT })
})

When('我按下 Escape 关闭全局搜索', async function (this: CradleWorld) {
  console.warn('[step] close global search with Escape')
  await expect(globalSearchInput(this)).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await this.page.keyboard.press('Escape')
})

Then('全局搜索命令{string}应可见', async function (this: CradleWorld, label: string) {
  console.warn(`[step] assert global search command visible: ${label}`)
  const row = commandRow(this, label)

  await expect(row).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(row).toContainText(label, { timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('全局搜索对话框应关闭', async function (this: CradleWorld) {
  console.warn('[step] assert global search dialog closed')
  await expect(globalSearchInput(this)).toBeHidden({ timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('全局搜索中应该显示 Issue 结果{string}', async function (this: CradleWorld, title: string) {
  console.warn(`[step] assert global search issue result visible: ${title}`)
  const result = issueResult(this, title)

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(result).toContainText(title, { timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('全局搜索中应该显示文件结果{string}', async function (this: CradleWorld, path: string) {
  console.warn(`[step] assert global search file result visible: ${path}`)
  const result = fileResult(this, path)

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(result).toContainText(path, { timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('全局搜索中应该显示会话{string}的标题高亮{string}', async function (this: CradleWorld, alias: string, query: string) {
  console.warn(`[step] assert global search title highlight for alias: ${alias}`)
  const session = recallSessionAlias(this, alias)
  const result = threadResult(this, session.id)
  const title = result.locator(`[data-testid="global-search-thread-title-${session.id}"]`)

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(title).toContainText(session.firstUserText, { timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(title.locator('mark')).toContainText(query, { timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('全局搜索中应该显示会话{string}的消息片段高亮{string}', async function (this: CradleWorld, alias: string, query: string) {
  console.warn(`[step] assert global search snippet highlight for alias: ${alias}`)
  const session = recallSessionAlias(this, alias)
  const result = threadResult(this, session.id)
  const snippet = result
    .locator('[data-testid^="global-search-thread-snippet-"]')
    .filter({ hasText: query })
    .first()

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(snippet).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(snippet).toContainText(query, { timeout: GLOBAL_SEARCH_TIMEOUT })
  await expect(snippet).not.toContainText('<mark>')
  await expect(snippet.locator('mark').first()).toContainText(query, { timeout: GLOBAL_SEARCH_TIMEOUT })
})

When('我从全局搜索打开会话{string}', async function (this: CradleWorld, alias: string) {
  console.warn(`[step] open chat session from global search: ${alias}`)
  const session = recallSessionAlias(this, alias)
  const result = threadResult(this, session.id)

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await result.click()
  await expect(globalSearchInput(this)).toBeHidden({ timeout: GLOBAL_SEARCH_TIMEOUT })
})

When('我从全局搜索打开 Issue 结果{string}', async function (this: CradleWorld, title: string) {
  console.warn(`[step] open issue result from global search: ${title}`)
  const result = issueResult(this, title)

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await result.click()
  await expect(globalSearchInput(this)).toBeHidden({ timeout: GLOBAL_SEARCH_TIMEOUT })
})

When('我从全局搜索打开文件结果{string}', async function (this: CradleWorld, path: string) {
  console.warn(`[step] open file result from global search: ${path}`)
  const result = fileResult(this, path)

  await expect(result).toBeVisible({ timeout: GLOBAL_SEARCH_TIMEOUT })
  await result.click()
  await expect(globalSearchInput(this)).toBeHidden({ timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('当前聊天视图应该打开会话{string}', async function (this: CradleWorld, alias: string) {
  console.warn(`[step] assert current chat view session: ${alias}`)
  const session = recallSessionAlias(this, alias)
  const chatView = await getActiveChatView(this)

  await expect(chatView).toHaveAttribute('data-chat-session-id', session.id, { timeout: GLOBAL_SEARCH_TIMEOUT })
})

Then('剪贴板应该包含文件路径{string}', async function (this: CradleWorld, path: string) {
  console.warn(`[step] assert clipboard contains file path: ${path}`)

  await expect.poll(async () => this.page.evaluate(() => navigator.clipboard.readText()), {
    timeout: GLOBAL_SEARCH_TIMEOUT,
  }).toBe(path)
})
