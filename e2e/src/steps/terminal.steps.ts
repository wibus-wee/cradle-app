import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { visibleChatView } from '../support/ui'
import type { CradleWorld } from '../support/world'

const TERMINAL_TIMEOUT = 30_000

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

  const workspace = await workspaceResponse.json() as {
    path?: string | null
    locator?: { path?: string | null } | null
  }
  const path = workspace.path ?? workspace.locator?.path ?? null
  if (!path) {
    throw new Error(`Expected workspace ${session.workspaceId} to have a path`)
  }

  return path
}

When('我打开底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] open bottom terminal panel')
  await this.terminalPage.open()
})

When('我关闭底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] close bottom terminal panel')
  await this.terminalPage.close()
})

Then('我应该看到底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal panel visible')
  await this.terminalPage.expectVisible()
})

Then('底部终端面板应处于关闭状态', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal panel closed')
  await this.terminalPage.expectClosed()
})

When('我在底部终端中执行命令{string}', async function (this: CradleWorld, command: string) {
  console.warn(`[step] run command in bottom terminal: ${command}`)
  await this.terminalPage.runCommand(command)
})

When('我新建一个底部终端会话', async function (this: CradleWorld) {
  console.warn('[step] create bottom terminal session')
  await this.terminalPage.createSession()
})

When('我切换到底部终端第 {int} 个会话', async function (this: CradleWorld, ordinal: number) {
  console.warn(`[step] switch bottom terminal session: ${ordinal}`)
  await this.terminalPage.activateSession(ordinal)
})

When('我关闭底部终端第 {int} 个会话', async function (this: CradleWorld, ordinal: number) {
  console.warn(`[step] close bottom terminal session: ${ordinal}`)
  const tab = this.page.locator('[data-testid="bottom-terminal-tab"]').nth(ordinal - 1)
  await expect(tab).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  const closeButton = tab.locator('[data-testid^="bottom-terminal-close-"]')
  await expect(closeButton).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  await closeButton.click()
})

Then('底部终端应显示 {int} 个会话标签', async function (this: CradleWorld, count: number) {
  console.warn(`[step] assert bottom terminal session count: ${count}`)
  await expect(this.page.locator('[data-testid="bottom-terminal-tab"]')).toHaveCount(count, { timeout: TERMINAL_TIMEOUT })
})

Then('底部终端第 {int} 个会话应处于活跃状态', async function (this: CradleWorld, ordinal: number) {
  console.warn(`[step] assert bottom terminal session active: ${ordinal}`)
  await expect(this.page.locator('[data-testid="bottom-terminal-tab"]').nth(ordinal - 1))
    .toHaveAttribute('data-active', 'true', { timeout: TERMINAL_TIMEOUT })
})

Then('底部终端应显示当前工作区路径哈希', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal shows current workspace path hash')
  const workspacePath = await getActiveChatWorkspacePath(this)
  await this.terminalPage.expectWorkspacePathHash(workspacePath)
})

Then('底部终端应显示文本{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert bottom terminal contains text: ${text}`)
  await this.terminalPage.expectTranscriptContains(text)
})

Then('底部终端不应显示文本{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert bottom terminal does not contain text: ${text}`)
  await this.terminalPage.expectTranscriptNotContains(text)
})

Then('可见 shell-view 应恰好有 1 个', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="shell-view"][data-shell-visible="true"]'))
    .toHaveCount(1, { timeout: TERMINAL_TIMEOUT })
})
