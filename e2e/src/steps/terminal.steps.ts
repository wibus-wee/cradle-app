import { createHash } from 'node:crypto'

import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { visibleChatView } from '../support/ui'
import type { CradleWorld } from '../support/world'

const TERMINAL_TIMEOUT = 30_000
const WHITESPACE_DOTS_RE = /[·\s]+/g

function getBottomPanel(world: CradleWorld) {
  return world.page.locator('[data-testid="app-layout-bottom-panel"]')
}

function getShellView(world: CradleWorld) {
  return world.page.locator('[data-testid="shell-view"]')
}

function getShellTextArea(world: CradleWorld) {
  return getShellView(world).locator('textarea.xterm-helper-textarea')
}

function getTerminalTabs(world: CradleWorld) {
  return world.page.locator('[data-testid="bottom-terminal-tab"]')
}

async function readShellVisibleText(world: CradleWorld): Promise<string> {
  return (await world.page.locator('[data-testid="shell-view-transcript"]').textContent()) ?? ''
}

function normalizeTerminalAssertionText(value: string): string {
  return value.replace(WHITESPACE_DOTS_RE, '')
}

async function waitForBottomShellReady(world: CradleWorld) {
  const shellView = getShellView(world)
  const textArea = getShellTextArea(world)

  await expect(shellView).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  await expect(shellView).toHaveAttribute('data-shell-ready', 'true', { timeout: TERMINAL_TIMEOUT })
  await expect(textArea).toBeAttached({ timeout: TERMINAL_TIMEOUT })
}

async function getActiveChatWorkspacePath(world: CradleWorld): Promise<string> {
  const chatView = visibleChatView(world)
  await expect(chatView).toBeVisible({ timeout: 10_000 })

  const sessionId = await chatView.getAttribute('data-chat-session-id')
  if (!sessionId) {
    throw new Error('Expected active chat view to expose a chat session id')
  }

  const sessionResponse = await fetch(`${world.params.serverUrl}/sessions/${sessionId}`)
  if (!sessionResponse.ok) {
    throw new Error(`Failed to load session ${sessionId}: ${sessionResponse.status} ${await sessionResponse.text()}`)
  }

  const session = await sessionResponse.json() as { workspaceId?: string | null }
  if (!session.workspaceId) {
    throw new Error(`Expected session ${sessionId} to have a workspaceId`)
  }

  const workspaceResponse = await fetch(`${world.params.serverUrl}/workspaces/${session.workspaceId}`)
  if (!workspaceResponse.ok) {
    throw new Error(`Failed to load workspace ${session.workspaceId}: ${workspaceResponse.status} ${await workspaceResponse.text()}`)
  }

  const workspace = await workspaceResponse.json() as { path?: string | null }
  if (!workspace.path) {
    throw new Error(`Expected workspace ${session.workspaceId} to have a path`)
  }

  return workspace.path
}

When('我打开底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] open bottom terminal panel')
  const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
  const panel = getBottomPanel(this)

  await expect(toggle).toBeVisible({ timeout: 10_000 })
  if ((await panel.getAttribute('data-panel-open')) !== 'true') {
    await toggle.click()
  }

  await expect(panel).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
})

When('我关闭底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] close bottom terminal panel')
  const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
  const panel = getBottomPanel(this)

  await expect(toggle).toBeVisible({ timeout: 10_000 })
  if ((await panel.getAttribute('data-panel-open')) !== 'false') {
    await toggle.click()
  }

  await expect(panel).toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
})

Then('我应该看到底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal panel visible')
  const panel = getBottomPanel(this)
  const shellView = getShellView(this)

  await expect(panel).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
  await expect(shellView).toBeVisible({ timeout: TERMINAL_TIMEOUT })
})

Then('底部终端面板应处于关闭状态', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal panel closed')
  await expect(getBottomPanel(this)).toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
})

When('我在底部终端中执行命令{string}', async function (this: CradleWorld, command: string) {
  console.warn(`[step] run command in bottom terminal: ${command}`)
  const shellView = getShellView(this)
  const textArea = getShellTextArea(this)

  await waitForBottomShellReady(this)
  await shellView.click()
  await textArea.focus()
  await this.page.keyboard.insertText(command)
  await this.page.keyboard.press('Enter')
})

When('我新建一个底部终端会话', async function (this: CradleWorld) {
  console.warn('[step] create bottom terminal session')
  const button = this.page.locator('[data-testid="bottom-terminal-new-session"]')
  await expect(button).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  await button.click()
})

When('我切换到底部终端第 {int} 个会话', async function (this: CradleWorld, ordinal: number) {
  console.warn(`[step] switch bottom terminal session: ${ordinal}`)
  const tab = getTerminalTabs(this).nth(ordinal - 1)
  await expect(tab).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  await tab.locator('button').first().click()
})

When('我关闭底部终端第 {int} 个会话', async function (this: CradleWorld, ordinal: number) {
  console.warn(`[step] close bottom terminal session: ${ordinal}`)
  const tab = getTerminalTabs(this).nth(ordinal - 1)
  await expect(tab).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  const closeButton = tab.locator('[data-testid^="bottom-terminal-close-"]')
  await expect(closeButton).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  await closeButton.click()
})

Then('底部终端应显示 {int} 个会话标签', async function (this: CradleWorld, count: number) {
  console.warn(`[step] assert bottom terminal session count: ${count}`)
  await expect(getTerminalTabs(this)).toHaveCount(count, { timeout: TERMINAL_TIMEOUT })
})

Then('底部终端第 {int} 个会话应处于活跃状态', async function (this: CradleWorld, ordinal: number) {
  console.warn(`[step] assert bottom terminal session active: ${ordinal}`)
  await expect(getTerminalTabs(this).nth(ordinal - 1)).toHaveAttribute('data-active', 'true', { timeout: TERMINAL_TIMEOUT })
})

Then('底部终端应显示当前工作区路径哈希', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal shows current workspace path hash')
  const workspacePath = await getActiveChatWorkspacePath(this)
  const expectedHash = createHash('sha1').update(`${workspacePath}\n`).digest('hex')

  await expect.poll(
    async () => normalizeTerminalAssertionText(await readShellVisibleText(this)),
    { timeout: TERMINAL_TIMEOUT },
  ).toContain(expectedHash)
})

Then('底部终端应显示文本{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert bottom terminal contains text: ${text}`)
  await expect.poll(
    async () => await readShellVisibleText(this),
    { timeout: TERMINAL_TIMEOUT },
  ).toContain(text)
})
