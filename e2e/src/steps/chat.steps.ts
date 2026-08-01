import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  assertSimulatorExhausted,
  CHAT_STATUS_TIMEOUT,
  clearBrowserClipboard,
  configureClaudeApprovalSimulator,
  configureCodexMultiTurnSimulator,
  configureDefaultAiReply,
  configureFailingClaudeAgentSimulator,
  configureMultiTurnClaudeAgentSimulator,
  configureReadToolLoopSimulator,
  configureSlowGatedClaudeAgentSimulator,
  configureThinkingClaudeAgentSimulator,
  createRememberedSession,
  expectChatStreaming,
  expectClipboardContainsMarkdownFragments,
  expectCurrentSessionUnderSelectedWorkspace,
  expectDefaultAiReply,
  expectPromptContains,
  expectSessionPinned,
  expectSessionTitle,
  expectSessionUnpinned,
  expectSidebarSessionOrder,
  expectToolCallContains,
  fillChatComposerWithNextReply,
  navigateToNewChatWithSimulator,
  openToolCall,
  recallSessionAlias,
  releaseSlowStreamGate,
  renameRememberedSession,
  selectClaudeAgentSimulator,
  selectCodexSimulator,
  selectNewChatWorkspace,
} from '../support/helpers/chat-scenario'
import type { CradleWorld } from '../support/world'

Given('应用已启动', async function (this: CradleWorld) {
  console.warn('[step] assert app is launched')
  await this.page.waitForLoadState('domcontentloaded')
})

Given('我已配置 Claude Agent 多轮 Simulator', async function (this: CradleWorld) {
  await configureMultiTurnClaudeAgentSimulator(this)
})

Given('我已配置带门控的慢速 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureSlowGatedClaudeAgentSimulator(this)
})

Given('我已配置会失败的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureFailingClaudeAgentSimulator(this)
})

Given('我已配置会返回 Thinking 的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureThinkingClaudeAgentSimulator(this)
})

Given('我已配置 Claude Agent 审批 Simulator', async function (this: CradleWorld) {
  await configureClaudeApprovalSimulator(this)
})

Given('我已配置 Codex Simulator', async function (this: CradleWorld) {
  await configureDefaultAiReply(this)
})

Given('我已配置 Claude Agent Read 工具环 Simulator', async function (this: CradleWorld) {
  await configureReadToolLoopSimulator(this)
})

Given('我已配置 Codex 多轮 Simulator', async function (this: CradleWorld) {
  await configureCodexMultiTurnSimulator(this)
})

Given('我已导航到新建聊天并选中 Simulator', async function (this: CradleWorld) {
  await navigateToNewChatWithSimulator(this)
})

When('我选择 Claude Agent 运行时与 Simulator Provider', async function (this: CradleWorld) {
  await selectClaudeAgentSimulator(this)
})

When('我选择 Codex 运行时与 Simulator Provider', async function (this: CradleWorld) {
  await selectCodexSimulator(this)
})

When('我释放慢速流门控', async function (this: CradleWorld) {
  await releaseSlowStreamGate(this)
})

Then('聊天流应结束于空闲状态', async function (this: CradleWorld) {
  await this.chat.waitStatus('idle')
})

Then('Simulator 脚本化交换应全部耗尽', async function (this: CradleWorld) {
  assertSimulatorExhausted(this)
})

When('我点击"新建聊天"导航项', async function (this: CradleWorld) {
  await this.newChat.openFromNav()
})

Given('我已导航到新建聊天页面', async function (this: CradleWorld) {
  await navigateToNewChatWithSimulator(this)
})

Then('我应该看到新建聊天页面', async function (this: CradleWorld) {
  await expect(this.newChat.entry()).toBeVisible({ timeout: 10_000 })
})

Then('聊天输入框应可见', async function (this: CradleWorld) {
  await expect(this.newChat.textBox()).toBeVisible({ timeout: 10_000 })
})

When('我在新建聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  await this.newChat.fill(text)
})

When('我点击新建聊天快速操作{string}', async function (this: CradleWorld, label: string) {
  const action = this.page.getByRole('button', { name: label, exact: true })
  await expect(action).toBeVisible({ timeout: 10_000 })
  await action.click()
})

When('我在新建聊天中选择第 {int} 个工作区', async function (this: CradleWorld, ordinal: number) {
  await selectNewChatWorkspace(this, ordinal)
})

When('我点击发送按钮', async function (this: CradleWorld) {
  await this.newChat.send()
})

Then('应该跳转到聊天视图', async function (this: CradleWorld) {
  await this.chat.waitVisible(20_000)
})

Then('我应该看到用户消息{string}', async function (this: CradleWorld, text: string) {
  await this.chat.expectUserMessage(text, CHAT_STATUS_TIMEOUT)
})

Then('新建聊天输入框应包含{string}', async function (this: CradleWorld, text: string) {
  await expectPromptContains(this, text)
})

Then('当前聊天会话应显示在选中的工作区下', async function (this: CradleWorld) {
  await expectCurrentSessionUnderSelectedWorkspace(this)
})

Then('我应该看到 AI 回复消息', async function (this: CradleWorld) {
  await expectDefaultAiReply(this)
})

Given('我已在新建聊天页面发送了初始消息', async function (this: CradleWorld) {
  console.warn('[step] create initial chat session from new-chat page')
  await createRememberedSession(this, '初始会话', '初始测试消息')
})

When('我新建一个聊天会话并记住为{string}，首条消息为{string}', async function (this: CradleWorld, alias: string, text: string) {
  await createRememberedSession(this, alias, text)
})

When('我在聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  await fillChatComposerWithNextReply(this, text)
})

When('我点击聊天发送按钮', async function (this: CradleWorld) {
  await this.chat.sendFromComposer()
})

Then('侧栏应显示至少一个会话项', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid^="session-item-"]').first()).toBeVisible({ timeout: 10_000 })
})

Then('侧栏应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await this.chat.waitForSessionInSidebar(recallSessionAlias(this, alias).id)
})

Then('侧栏中不应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await expect(this.chat.sessionItem(recallSessionAlias(this, alias).id)).toHaveCount(0, { timeout: 10_000 })
})

Then('侧栏会话顺序应为{string}在{string}之前', async function (this: CradleWorld, firstAlias: string, secondAlias: string) {
  await expectSidebarSessionOrder(this, firstAlias, secondAlias)
})

Then('最后一条 AI 消息应包含{string}', async function (this: CradleWorld, text: string) {
  await this.chat.expectAssistantContains(text, CHAT_STATUS_TIMEOUT)
})

Then('聊天中不应出现错误提示', async function (this: CradleWorld) {
  await this.chat.expectNoError()
})

Then('跟进消息{string}应显示在聊天队列中', async function (this: CradleWorld, text: string) {
  const queueList = this.page.locator('[data-testid="chat-queue-list"]')
  await expect(queueList).toBeVisible({ timeout: 10_000 })
  await expect(queueList.locator('[data-testid="chat-queue-item"]').filter({ hasText: text })).toBeVisible({ timeout: 10_000 })
})

Then('聊天队列中不应显示跟进消息{string}', async function (this: CradleWorld, text: string) {
  await expect(this.page.locator('[data-testid="chat-queue-item"]').filter({ hasText: text })).toHaveCount(0, { timeout: CHAT_STATUS_TIMEOUT })
})

Then('聊天流应处于进行中', async function (this: CradleWorld) {
  await expectChatStreaming(this)
})

When('我点击停止生成按钮', async function (this: CradleWorld) {
  await this.chat.stop()
})

Then('停止生成按钮应消失', async function (this: CradleWorld) {
  await this.chat.expectStopGone(CHAT_STATUS_TIMEOUT)
})

When('我打开会话{string}的菜单', async function (this: CradleWorld, alias: string) {
  await this.chat.openSessionMenu(recallSessionAlias(this, alias).id)
})

When('我点击会话{string}的置顶菜单项', async function (this: CradleWorld, alias: string) {
  await this.chat.clickSessionMenuAction(recallSessionAlias(this, alias).id, 'toggle-pin')
})

When('我点击会话{string}的取消置顶菜单项', async function (this: CradleWorld, alias: string) {
  await this.chat.clickSessionMenuAction(recallSessionAlias(this, alias).id, 'toggle-pin')
})

When('我点击会话{string}的删除菜单项', async function (this: CradleWorld, alias: string) {
  await this.chat.clickSessionMenuAction(recallSessionAlias(this, alias).id, 'archive')
})

When('我点击会话{string}的重命名菜单项', async function (this: CradleWorld, alias: string) {
  await this.chat.clickSessionMenuAction(recallSessionAlias(this, alias).id, 'rename')
})

When('我将会话{string}重命名为{string}', async function (this: CradleWorld, alias: string, nextTitle: string) {
  await renameRememberedSession(this, alias, nextTitle)
})

When('我点击会话{string}的复制 Markdown 菜单项', async function (this: CradleWorld, alias: string) {
  await this.chat.clickSessionMenuAction(recallSessionAlias(this, alias).id, 'copy-markdown')
})

When('我清空 Electron 剪贴板', async function (this: CradleWorld) {
  await clearBrowserClipboard(this)
})

Then('我应该看到至少一条 AI 消息', async function (this: CradleWorld) {
  const assistantBubbles = this.page.locator('[data-testid="message-bubble-assistant"]')
  expect(await assistantBubbles.count()).toBeGreaterThanOrEqual(1)
  await expect(assistantBubbles.last()).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
})

Then('聊天错误提示应显示{string}', async function (this: CradleWorld, text: string) {
  await this.chat.expectErrorContains(text, {
    timeout: Math.max(CHAT_STATUS_TIMEOUT, 60_000),
  })
})

When('我重新加载当前页面', async function (this: CradleWorld) {
  await this.page.reload()
  await this.page.waitForLoadState('domcontentloaded')
  await this.chat.waitVisible()
})

Then('会话{string}应显示为已置顶', async function (this: CradleWorld, alias: string) {
  await expectSessionPinned(this, alias)
})

Then('会话{string}不应显示为已置顶', async function (this: CradleWorld, alias: string) {
  await expectSessionUnpinned(this, alias)
})

Then('侧栏中的会话{string}标题应为{string}', async function (this: CradleWorld, alias: string, expectedTitle: string) {
  await expectSessionTitle(this, alias, expectedTitle)
})

Then('最后一条 AI 消息应显示 Reasoning 入口', async function (this: CradleWorld) {
  await this.chat.openReasoningEntry()
})

When('我展开最后一条 AI 消息的 Reasoning', async function (this: CradleWorld) {
  await this.chat.openReasoningEntry()
})

Then('最后一条 AI 消息的 Reasoning 应包含{string}', async function (this: CradleWorld, text: string) {
  await this.chat.expectReasoningContains(text)
})

Then('最后一条 AI 消息应显示已展开的 Thought 条目', async function (this: CradleWorld) {
  await this.chat.expectThoughtEntryVisible()
})

Then('聊天活动流应包含{string}', async function (this: CradleWorld, text: string) {
  await this.chat.expectActivityContains(text, CHAT_STATUS_TIMEOUT)
})

Then('最后一条 AI 消息应显示名为{string}的 Tool Call', async function (this: CradleWorld, toolName: string) {
  await this.chat.waitStatus('idle')
  await this.chat.toolCallBlock(toolName)
})

When('我展开最后一条 AI 消息中名为{string}的 Tool Call', async function (this: CradleWorld, toolName: string) {
  await openToolCall(this, toolName)
})

Then('最后一条 AI 消息中名为{string}的 Tool Call 输入应包含{string}', async function (this: CradleWorld, toolName: string, text: string) {
  await expectToolCallContains(this, toolName, text)
})

Then('最后一条 AI 消息中名为{string}的 Tool Call 输出应包含{string}', async function (this: CradleWorld, toolName: string, text: string) {
  await expectToolCallContains(this, toolName, text)
})

Then('Electron 剪贴板中应包含以下 Markdown 片段:', async function (this: CradleWorld, table: DataTable) {
  await expectClipboardContainsMarkdownFragments(this, table)
})
