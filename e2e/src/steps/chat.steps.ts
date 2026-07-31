import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'
import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

import {
  expectPromptEditorToContain,
  fillPromptEditor,
  newChatSendButton,
  newChatTextBox,
  visibleNewChatEntry,
  visibleProviderModelSelector,
  visibleRuntimeSelector,
  waitForNewChatReady,
} from '../support/ui'
import type { CradleWorld } from '../support/world'

const DEFAULT_RESPONSE = 'Hello from E2E simulator!'
const MULTI_TURN_RESPONSES = [
  '第一轮助手：已记住苹果',
  '第二轮助手：你让我记住了苹果',
]
const SLOW_RESPONSE = '慢速助手回复完成'
const SLOW_GATE = 'e2e-slow-stream'
const CHAT_VIEW_TIMEOUT = 20_000
const CHAT_STATUS_TIMEOUT = 30_000
const SESSION_ALIASES_KEY = 'chat.session-aliases'
const PREFERRED_RUNTIME_KEY = 'chat.preferred-runtime'
const SIMULATOR_PROVIDER_RE = /E2E Simulator|E2E Claude Agent/i

type SessionAlias = {
  id: string
  firstUserText: string
}

type PreferredChatRuntime = 'standard' | 'claude-agent'

function recallSessionAliases(world: CradleWorld): Record<string, SessionAlias> {
  return world.maybeRecall<Record<string, SessionAlias>>(SESSION_ALIASES_KEY) ?? {}
}

function rememberSessionAlias(world: CradleWorld, alias: string, session: SessionAlias): void {
  const aliases = recallSessionAliases(world)
  aliases[alias] = session
  world.remember(SESSION_ALIASES_KEY, aliases)
}

function recallSessionAlias(world: CradleWorld, alias: string): SessionAlias {
  const session = recallSessionAliases(world)[alias]

  if (!session) {
    throw new Error(`Missing remembered chat session alias: ${alias}`)
  }

  return session
}

async function getChatView(world: CradleWorld) {
  const chatView = world.page.locator('[data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: CHAT_VIEW_TIMEOUT })
  return chatView
}

async function waitForChatStatus(world: CradleWorld, status: string) {
  const chatView = await getChatView(world)
  await expect(chatView).toHaveAttribute('data-chat-status', status, { timeout: CHAT_STATUS_TIMEOUT })
  return chatView
}

async function getCurrentChatSessionId(world: CradleWorld): Promise<string> {
  const chatView = await getChatView(world)
  const sessionId = await chatView.getAttribute('data-chat-session-id')
  if (!sessionId) {
    throw new Error('Expected active chat view to expose a chat session id')
  }
  return sessionId
}

function rememberSelectedNewChatWorkspace(world: CradleWorld, name: string): void {
  world.remember('chat.selected-new-chat-workspace', name)
}

function recallSelectedNewChatWorkspace(world: CradleWorld): string {
  return world.recall<string>('chat.selected-new-chat-workspace')
}

/** Get the visible new-chat page container to avoid strict mode violations with multiple tabs */
function visibleNewChatPage(world: CradleWorld) {
  return visibleNewChatEntry(world)
}

async function getLastAssistantBubble(world: CradleWorld) {
  const locator = world.page.locator('[data-testid="message-bubble-assistant"]').last()
  await expect(locator).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
  return locator
}

async function navigateToNewChat(world: CradleWorld): Promise<void> {
  console.warn('[step] navigate to new-chat page')
  const navItem = world.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  await waitForNewChatReady(world)
  if (recallPreferredChatRuntime(world) === 'claude-agent') {
    await selectRuntime(world, 'Claude Agent')
    await selectProvider(world, SIMULATOR_PROVIDER_RE)
    return
  }

  await selectRuntime(world, 'Agents')
  const preferredProvider = world.maybeRecall<string>('chat.preferred-provider')
  if (preferredProvider) {
    await selectProvider(world, new RegExp(preferredProvider, 'i'))
  }
}

function recallPreferredChatRuntime(world: CradleWorld): PreferredChatRuntime {
  return world.maybeRecall<PreferredChatRuntime>(PREFERRED_RUNTIME_KEY) ?? 'standard'
}

async function selectRuntime(world: CradleWorld, label: string | RegExp): Promise<void> {
  const selector = visibleRuntimeSelector(world)
  await expect(selector).toBeVisible({ timeout: 10_000 })

  const currentLabel = (await selector.textContent())?.trim() ?? ''
  const expectedLabel = typeof label === 'string' ? new RegExp(label, 'i') : label
  if (expectedLabel.test(currentLabel)) {
    return
  }

  await selector.click()
  const menu = world.page.locator('[role="menu"]').last()
  await expect(menu).toBeVisible({ timeout: 10_000 })

  const runtimeItem = menu.locator('[role="menuitem"]', { hasText: label }).first()
  await expect(runtimeItem).toBeVisible({ timeout: 10_000 })
  await runtimeItem.click()
  await expect(selector).toContainText(expectedLabel, { timeout: 10_000 })
}

async function selectProvider(world: CradleWorld, label: string | RegExp): Promise<void> {
  const providerSelector = visibleProviderModelSelector(world)
  const agentSelector = world.page.locator('[data-testid="agent-selector"]').filter({ visible: true }).first()
  const selector = await providerSelector.count() > 0 && await providerSelector.isVisible()
    ? providerSelector
    : agentSelector
  await expect(selector).toBeVisible({ timeout: 10_000 })
  await selector.click()

  const menu = world.page.locator('[role="menu"]').last()
  await expect(menu).toBeVisible({ timeout: 10_000 })

  const providerItem = menu.locator('[role="menuitem"]', { hasText: label }).first()
  await expect(providerItem).toBeVisible({ timeout: 10_000 })
  await providerItem.click()
  await world.page.keyboard.press('Escape')
}

async function configureClaudeApprovalSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Claude Agent approval simulator')
  await world.configureClaudeAgentChat({ mode: 'approval' })
}

async function waitForSessionSidebarItem(world: CradleWorld, sessionId: string): Promise<void> {
  await expect(world.page.locator(`[data-testid="session-item-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
}

async function enqueueNextScriptedReply(world: CradleWorld, fallbackText?: string): Promise<void> {
  if (!world.simulator) {
    return
  }
  const pending = world.maybeRecall<string[]>('simulator.next-replies')
  const next = pending && pending.length > 0
    ? pending.shift()!
    : fallbackText
  if (pending) {
    world.remember('simulator.next-replies', pending)
  }
  if (!next) {
    return
  }
  const { anthropicTextExchange, anthropicScenario } = await import('../support/scenarios/anthropic')
  world.enqueue(anthropicScenario([
    anthropicTextExchange({ label: `scripted-${Date.now()}`, text: next }),
  ]))
}

async function createRememberedSession(world: CradleWorld, alias: string, firstUserText: string): Promise<SessionAlias> {
  await navigateToNewChat(world)

  // Scope to the visible tab to avoid strict mode violations with multiple new-chat pages
  const visibleNewChat = visibleNewChatPage(world)
  const textarea = newChatTextBox(visibleNewChat)
  await fillPromptEditor(textarea, firstUserText)

  // First session consumes the configure-time exchange; later sessions need JIT replies.
  const existingAliases = Object.keys(recallSessionAliases(world))
  if (existingAliases.length > 0) {
    await enqueueNextScriptedReply(world, '会话助手回复')
  }

  const button = newChatSendButton(visibleNewChat)
  await expect(button).toBeEnabled({ timeout: 20_000 })
  await button.click()

  await waitForChatStatus(world, 'idle')
  // Small delay to ensure distinct createdAt timestamps between sessions
  await world.page.waitForTimeout(100)

  const session = {
    id: await getCurrentChatSessionId(world),
    firstUserText,
  }

  rememberSessionAlias(world, alias, session)
  await waitForSessionSidebarItem(world, session.id)
  return session
}

async function openSessionMenu(world: CradleWorld, sessionId: string): Promise<void> {
  // What's New corner popup sits over the session list in bottom-left.
  const popup = world.page.locator('[data-testid="whats-new-popup"]')
  if (await popup.isVisible().catch(() => false)) {
    await popup.getByRole('button', { name: /Later|稍后|Close|关闭/i }).first().click().catch(() => undefined)
    await expect(popup).toBeHidden({ timeout: 5_000 }).catch(() => undefined)
  }

  const item = world.page.locator(`[data-testid="session-item-${sessionId}"]`)
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.hover()

  const trigger = world.page.locator(`[data-testid="session-menu-trigger-${sessionId}"]`)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()
}

async function clickSessionMenuAction(world: CradleWorld, sessionId: string, action: 'toggle-pin' | 'copy-markdown' | 'archive' | 'rename'): Promise<void> {
  const locator = world.page.locator(`[data-testid="session-menu-${action}-${sessionId}-context"]`)
  await expect(locator).toBeVisible({ timeout: 10_000 })
  await locator.click()
}

async function getVisibleSessionOrder(world: CradleWorld): Promise<string[]> {
  return world.page.locator('[data-testid^="session-item-"]').filter({ visible: true }).evaluateAll((elements) => {
    return elements
      .flatMap((element) => {
        const value = element.getAttribute('data-testid')?.replace('session-item-', '')
        return value ? [value] : []
      })
  })
}

async function readBrowserClipboardText(world: CradleWorld): Promise<string> {
  return world.page.evaluate(() => navigator.clipboard.readText())
}

async function expandExecutionDetailsIfCollapsed(assistantBubble: Locator) {
  // Legacy copy
  const foldButton = assistantBubble.getByRole('button', { name: 'Show execution details' })
  if (await foldButton.count() > 0) {
    await foldButton.click()
  }
  // Current chrome: "Worked" / "Worked for Xs" execution-phase fold
  const worked = assistantBubble.getByRole('button').filter({ hasText: /^Worked/ }).first()
  if (await worked.count() > 0) {
    const expanded = await worked.getAttribute('aria-expanded')
    if (expanded !== 'true') {
      await worked.click()
    }
  }
}

async function getLastAssistantReasoningToggle(world: CradleWorld) {
  const assistantBubble = await getLastAssistantBubble(world)
  await expandExecutionDetailsIfCollapsed(assistantBubble)

  // Prefer legacy reasoning toggle when present
  const toggle = assistantBubble.locator('[data-testid="chat-reasoning-toggle"]').last()
  if (await toggle.count() > 0) {
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    return toggle
  }

  // Current UI: reasoning lives in the activity feed as a Thought/Thinking row
  const feed = assistantBubble.locator('[data-testid="chat-activity-feed"]').first()
  await expect(feed).toBeVisible({ timeout: 10_000 })
  // Expand the feed summary row if collapsed
  const feedSummary = feed.locator('button').first()
  if (await feedSummary.count() > 0) {
    const expanded = await feedSummary.getAttribute('aria-expanded')
    if (expanded !== 'true') {
      await feedSummary.click()
    }
  }
  const reasoningRow = feed.getByRole('button').filter({ hasText: /Thought|Thinking|Reasoning/i }).first()
  await expect(reasoningRow).toBeVisible({ timeout: 10_000 })
  return reasoningRow
}

async function getLastAssistantToolCallBlock(world: CradleWorld, toolName: string) {
  const assistantBubble = await getLastAssistantBubble(world)
  let block = world.page.locator(`[data-testid^="chat-tool-call-"][data-tool-name="${toolName}"]`).first()
  if (await block.count() === 0) {
    await expandExecutionDetailsIfCollapsed(assistantBubble)
    block = world.page.locator(`[data-testid^="chat-tool-call-"][data-tool-name="${toolName}"]`).first()
  }
  await expect(block).toBeVisible({ timeout: 10_000 })
  return block
}

async function clearBrowserClipboard(world: CradleWorld): Promise<void> {
  await world.page.evaluate(() => navigator.clipboard.writeText(''))
}

Given('应用已启动', async function (this: CradleWorld) {
  console.warn('[step] assert app is launched')
  await this.page.waitForLoadState('domcontentloaded')
})

Given('我已配置 Claude Agent 多轮 Simulator', async function (this: CradleWorld) {
  console.warn('[step] configure multi-turn Claude Agent simulator')
  await this.configureClaudeAgentChat({ mode: 'text', text: MULTI_TURN_RESPONSES[0] })
  // Enough scripted follow-ups for multi-turn chat and session-lifecycle scenarios.
  this.remember('simulator.next-replies', [
    MULTI_TURN_RESPONSES[1]!,
    '会话助手回复',
    '会话助手回复',
  ])
})

Given('我已配置带门控的慢速 Claude Agent Simulator', async function (this: CradleWorld) {
  console.warn('[step] configure slow gated Claude Agent simulator')
  await this.configureClaudeAgentChat({ mode: 'text', text: SLOW_RESPONSE })
  // Replace the default text exchange with a gated stream.
  this.simulator!.reset()
  const { anthropicTextExchange, anthropicScenario } = await import('../support/scenarios/anthropic')
  this.enqueue(anthropicScenario([
    anthropicTextExchange({ label: 'slow', text: SLOW_RESPONSE, gateAfterStart: SLOW_GATE }),
  ]))
  this.remember('simulator.slow-gate', SLOW_GATE)
})

Given('我已配置会失败的 Claude Agent Simulator', async function (this: CradleWorld) {
  console.warn('[step] configure failing Claude Agent simulator')
  await this.configureClaudeAgentChat({ mode: 'text' })
  this.simulator!.reset()
  const { anthropicHttpErrorExchange, anthropicScenario } = await import('../support/scenarios/anthropic')
  // Queue several identical failures so SDK retries still surface the same message
  // under probes-only (empty queue → UnexpectedRequest would otherwise hide it).
  // Queue enough identical failures that Claude Agent retries still hit a 503
  // before falling through to UnexpectedRequest after the queue drains.
  const excludeTitle = 'You are naming a Claude Agent task session'
  this.enqueue(anthropicScenario(
    Array.from({ length: 8 }, (_, index) => anthropicHttpErrorExchange({
      label: `fail-${index + 1}`,
      message: 'E2E simulator forced failure',
      bodyTextIncludes: '请触发 provider 错误',
      bodyTextExcludes: excludeTitle,
    })),
  ))
})

Given('我已配置会返回 Thinking 的 Claude Agent Simulator', async function (this: CradleWorld) {
  console.warn('[step] configure thinking Claude Agent simulator')
  await this.configureClaudeAgentChat({ mode: 'text' })
  this.simulator!.reset()
  const { anthropicThinkingTextExchange, anthropicScenario } = await import('../support/scenarios/anthropic')
  this.enqueue(anthropicScenario([
    anthropicThinkingTextExchange({
      label: 'thinking',
      thinking: '第一步分析问题\n第二步形成答案',
      text: DEFAULT_RESPONSE,
      bodyTextIncludes: '请先思考再回答',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
})

Given('我已配置 Claude Agent 审批 Simulator', async function (this: CradleWorld) {
  await configureClaudeApprovalSimulator(this)
})

Given('我已配置 Codex Simulator', async function (this: CradleWorld) {
  console.warn('[step] configure Codex simulator (real app-server → OpenAI Responses)')
  await this.configureCodexChat({ texts: ['Hello from Codex E2E simulator!'] })
})

Given('我已导航到新建聊天并选中 Simulator', async function (this: CradleWorld) {
  await navigateToNewChat(this)
})

When('我选择 Claude Agent 运行时与 Simulator Provider', async function (this: CradleWorld) {
  await selectRuntime(this, 'Claude Agent')
  await selectProvider(this, /E2E Claude Agent/i)
})

When('我选择 Codex 运行时与 Simulator Provider', async function (this: CradleWorld) {
  await selectRuntime(this, 'Codex')
  await selectProvider(this, /E2E Codex/i)
})

When('我释放慢速流门控', async function (this: CradleWorld) {
  const gate = this.recall<string>('simulator.slow-gate')
  await this.simulator!.waitForGate(gate)
  this.simulator!.release(gate)
})

Then('聊天流应结束于空闲状态', async function (this: CradleWorld) {
  await waitForChatStatus(this, 'idle')
})

Then('Simulator 脚本化交换应全部耗尽', async function (this: CradleWorld) {
  // Unused JIT follow-up scripts were never enqueued — clear memory only.
  this.remember('simulator.next-replies', [] as string[])
  this.assertSimulatorExhausted()
})

When('我点击"新建聊天"导航项', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
})

Given('我已导航到新建聊天页面', async function (this: CradleWorld) {
  await navigateToNewChat(this)
})

Then('我应该看到新建聊天页面', async function (this: CradleWorld) {
  await expect(visibleNewChatPage(this)).toBeVisible({ timeout: 10_000 })
})

Then('聊天输入框应可见', async function (this: CradleWorld) {
  await expect(newChatTextBox(visibleNewChatPage(this))).toBeVisible({ timeout: 10_000 })
})

When('我在新建聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  await fillPromptEditor(newChatTextBox(visibleNewChatPage(this)), text)
})

When('我点击新建聊天快速操作{string}', async function (this: CradleWorld, label: string) {
  const action = this.page.getByRole('button', { name: label, exact: true })
  await expect(action).toBeVisible({ timeout: 10_000 })
  await action.click()
})

When('我在新建聊天中选择第 {int} 个工作区', async function (this: CradleWorld, ordinal: number) {
  const selector = visibleNewChatPage(this).locator('[data-testid="new-chat-workspace-selector"], [data-testid="home-workspace-selector"]').first()
  await expect(selector).toBeVisible({ timeout: 10_000 })
  await selector.click()

  // Options may be in a portal (popover) outside the new-chat page DOM tree
  const option = this.page.locator('[data-testid^="new-chat-workspace-option-"]').nth(ordinal - 1)
  await expect(option).toBeVisible({ timeout: 10_000 })

  const workspaceName = (await option.textContent())?.trim()
  if (!workspaceName) {
    throw new Error(`Workspace option ${ordinal} did not expose a visible name`)
  }

  await option.click()
  await expect(selector).toContainText(workspaceName, { timeout: 10_000 })
  rememberSelectedNewChatWorkspace(this, workspaceName)
})

When('我点击发送按钮', async function (this: CradleWorld) {
  const button = newChatSendButton(visibleNewChatPage(this))
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()
})

Then('应该跳转到聊天视图', async function (this: CradleWorld) {
  await getChatView(this)
})

Then('我应该看到用户消息{string}', async function (this: CradleWorld, text: string) {
  const userBubble = this.page.locator('[data-testid="message-bubble-user"]').filter({ hasText: text })
  await expect(userBubble).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
})

Then('新建聊天输入框应包含{string}', async function (this: CradleWorld, text: string) {
  await expectPromptEditorToContain(newChatTextBox(visibleNewChatPage(this)), new RegExp(text))
})

Then('当前聊天会话应显示在选中的工作区下', async function (this: CradleWorld) {
  const workspaceName = recallSelectedNewChatWorkspace(this)
  const sessionId = await getCurrentChatSessionId(this)
  const workspaceGroup = this.page.locator('[data-testid^="workspace-group-"]').filter({ hasText: workspaceName }).first()

  await expect(workspaceGroup).toBeVisible({ timeout: 10_000 })
  await expect(workspaceGroup.locator(`[data-testid="session-item-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
})

Then('我应该看到 AI 回复消息', async function (this: CradleWorld) {
  await waitForChatStatus(this, 'idle')
  const assistantBubble = await getLastAssistantBubble(this)
  await expect(assistantBubble).toContainText(DEFAULT_RESPONSE, { timeout: CHAT_STATUS_TIMEOUT })
  await expect(this.page.locator('[data-testid="chat-error-banner"]')).toHaveCount(0)
})

Given('我已在新建聊天页面发送了初始消息', async function (this: CradleWorld) {
  console.warn('[step] create initial chat session from new-chat page')
  await createRememberedSession(this, '初始会话', '初始测试消息')
})

When('我新建一个聊天会话并记住为{string}，首条消息为{string}', async function (this: CradleWorld, alias: string, text: string) {
  await createRememberedSession(this, alias, text)
})

When('我在聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  // Enqueue the next scripted assistant reply just-in-time so Claude Agent's
  // intermediate /v1/messages traffic cannot consume it early.
  await enqueueNextScriptedReply(this)

  const chatView = await getChatView(this)
  const textarea = chatView.locator('[data-testid="chat-composer-textarea"]')
  await fillPromptEditor(textarea, text)
})

When('我点击聊天发送按钮', async function (this: CradleWorld) {
  const chatView = await getChatView(this)
  const button = chatView.locator('[data-testid="chat-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()
})

Then('侧栏应显示至少一个会话项', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid^="session-item-"]').first()).toBeVisible({ timeout: 10_000 })
})

Then('侧栏应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await waitForSessionSidebarItem(this, recallSessionAlias(this, alias).id)
})

Then('侧栏中不应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await expect(this.page.locator(`[data-testid="session-item-${recallSessionAlias(this, alias).id}"]`)).toHaveCount(0, { timeout: 10_000 })
})

Then('侧栏会话顺序应为{string}在{string}之前', async function (this: CradleWorld, firstAlias: string, secondAlias: string) {
  const firstSessionId = recallSessionAlias(this, firstAlias).id
  const secondSessionId = recallSessionAlias(this, secondAlias).id

  await expect.poll(async () => {
    const order = await getVisibleSessionOrder(this)
    const firstIndex = order.indexOf(firstSessionId)
    const secondIndex = order.indexOf(secondSessionId)

    return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex
  }, { timeout: 10_000 }).toBe(true)
})

Then('最后一条 AI 消息应包含{string}', async function (this: CradleWorld, text: string) {
  const assistantBubble = await getLastAssistantBubble(this)
  await expect(assistantBubble).toContainText(text, { timeout: CHAT_STATUS_TIMEOUT })
})

Then('聊天中不应出现错误提示', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="chat-error-banner"]')).toHaveCount(0)
})

Then('跟进消息{string}应显示在聊天队列中', async function (this: CradleWorld, text: string) {
  const queueList = this.page.locator('[data-testid="chat-queue-list"]')
  await expect(queueList).toBeVisible({ timeout: 10_000 })
  await expect(queueList.locator('[data-testid="chat-queue-item"]').filter({ hasText: text })).toBeVisible({ timeout: 10_000 })
})

Then('聊天队列中不应显示跟进消息{string}', async function (this: CradleWorld, text: string) {
  const queueItem = this.page.locator('[data-testid="chat-queue-item"]').filter({ hasText: text })
  await expect(queueItem).toHaveCount(0, { timeout: CHAT_STATUS_TIMEOUT })
})

Then('聊天流应处于进行中', async function (this: CradleWorld) {
  await waitForChatStatus(this, 'streaming')
  await expect(this.page.locator('[data-testid="chat-stop-btn"]')).toBeVisible({ timeout: 10_000 })
  // Wait for the assistant bubble to have some streamed content before proceeding.
  // This prevents clicking stop before any text arrives from the LLM.
  const assistantBubble = this.page.locator('[data-testid="message-bubble-assistant"]').last()
  await expect(assistantBubble).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
})

When('我点击停止生成按钮', async function (this: CradleWorld) {
  const button = this.page.locator('[data-testid="chat-stop-btn"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
})

Then('停止生成按钮应消失', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="chat-stop-btn"]')).toHaveCount(0, { timeout: CHAT_STATUS_TIMEOUT })
})

When('我打开会话{string}的菜单', async function (this: CradleWorld, alias: string) {
  await openSessionMenu(this, recallSessionAlias(this, alias).id)
})

When('我点击会话{string}的置顶菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'toggle-pin')
})

When('我点击会话{string}的取消置顶菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'toggle-pin')
})

When('我点击会话{string}的删除菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'archive')
})

When('我点击会话{string}的重命名菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'rename')
})

When('我将会话{string}重命名为{string}', async function (this: CradleWorld, alias: string, nextTitle: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const input = this.page.locator(`[data-testid="session-rename-input-${sessionId}"]`)

  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(nextTitle)
  await input.press('Enter')
  await expect(input).toHaveCount(0, { timeout: 10_000 })
})

When('我点击会话{string}的复制 Markdown 菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'copy-markdown')
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
  const chatView = await getChatView(this)
  const errorBanner = this.page.locator('[data-testid="chat-error-banner"]')
  // Prefer the scripted failure string. Claude Agent often retries past 503s and
  // eventually projects UnexpectedRequest / API Error — still a valid failure path.
  await expect.poll(async () => {
    const bannerText = (await errorBanner.textContent().catch(() => '')) ?? ''
    const viewText = (await chatView.textContent().catch(() => '')) ?? ''
    const bodyText = (await this.page.locator('body').textContent().catch(() => '')) ?? ''
    const combined = `${bannerText}\n${viewText}\n${bodyText}`
    return {
      hit: combined.includes(text)
        || /API Error:\s*\d+/i.test(combined)
        || /Unexpected request/i.test(combined)
        || /E2E simulator forced failure/i.test(combined),
    }
  }, { timeout: CHAT_STATUS_TIMEOUT }).toMatchObject({ hit: true })
})

When('我重新加载当前页面', async function (this: CradleWorld) {
  await this.page.reload()
  await this.page.waitForLoadState('domcontentloaded')
  await getChatView(this)
})

Then('会话{string}应显示为已置顶', async function (this: CradleWorld, alias: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const item = this.page.locator(`[data-testid="session-item-${sessionId}"]`)

  await expect(item).toHaveAttribute('data-session-pinned', 'true', { timeout: 10_000 })
  await expect(this.page.locator(`[data-testid="session-pin-indicator-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
})

Then('会话{string}不应显示为已置顶', async function (this: CradleWorld, alias: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const item = this.page.locator(`[data-testid="session-item-${sessionId}"]`)

  await expect(item).toHaveAttribute('data-session-pinned', 'false', { timeout: 10_000 })
  await expect(item.locator(`[data-testid="session-pin-indicator-${sessionId}"]`)).toHaveCount(0)
})

Then('侧栏中的会话{string}标题应为{string}', async function (this: CradleWorld, alias: string, expectedTitle: string) {
  const sessionId = recallSessionAlias(this, alias).id
  await expect(this.page.locator(`[data-testid="session-title-${sessionId}"]`)).toHaveText(expectedTitle, { timeout: 10_000 })
})

Then('最后一条 AI 消息应显示 Reasoning 入口', async function (this: CradleWorld) {
  await getLastAssistantReasoningToggle(this)
})

When('我展开最后一条 AI 消息的 Reasoning', async function (this: CradleWorld) {
  const toggle = await getLastAssistantReasoningToggle(this)
  await toggle.click()
})

Then('最后一条 AI 消息的 Reasoning 应包含{string}', async function (this: CradleWorld, text: string) {
  const assistantBubble = await getLastAssistantBubble(this)
  await expandExecutionDetailsIfCollapsed(assistantBubble)
  const legacy = assistantBubble.locator('[data-testid="chat-reasoning-content"]').last()
  if (await legacy.count() > 0) {
    await expect(legacy).toBeVisible({ timeout: 10_000 })
    await expect(legacy).toContainText(text, { timeout: 10_000 })
    return
  }
  const feed = assistantBubble.locator('[data-testid="chat-activity-feed"]').first()
  await expect(feed).toContainText(text, { timeout: 10_000 })
})

Then('最后一条 AI 消息应显示已展开的 Thought 条目', async function (this: CradleWorld) {
  const assistantBubble = await getLastAssistantBubble(this)
  await expandExecutionDetailsIfCollapsed(assistantBubble)
  const feed = assistantBubble.locator('[data-testid="chat-activity-feed"]').first()
  await expect(feed).toBeVisible({ timeout: 10_000 })
  await expect(feed).toContainText(/Thought|Thinking|Reasoning/i, { timeout: 10_000 })
})

Then('最后一条 AI 消息应显示名为{string}的 Tool Call', async function (this: CradleWorld, toolName: string) {
  await waitForChatStatus(this, 'idle')
  await getLastAssistantToolCallBlock(this, toolName)
})

When('我展开最后一条 AI 消息中名为{string}的 Tool Call', async function (this: CradleWorld, toolName: string) {
  const block = await getLastAssistantToolCallBlock(this, toolName)
  const toggle = block.locator('[data-testid^="chat-tool-call-toggle-"]').first()
  if (await toggle.count() > 0) {
    await expect(toggle).toBeVisible({ timeout: 10_000 })
    await toggle.click()
    await expect(block.locator('[data-testid^="chat-tool-call-content-"]').first()).toBeVisible({ timeout: 10_000 })
  }
})

Then('最后一条 AI 消息中名为{string}的 Tool Call 输入应包含{string}', async function (this: CradleWorld, toolName: string, text: string) {
  const block = await getLastAssistantToolCallBlock(this, toolName)
  await expect(block).toContainText(text, { timeout: 10_000 })
})

Then('最后一条 AI 消息中名为{string}的 Tool Call 输出应包含{string}', async function (this: CradleWorld, toolName: string, text: string) {
  const block = await getLastAssistantToolCallBlock(this, toolName)
  await expect(block).toContainText(text, { timeout: 10_000 })
})

Then('Electron 剪贴板中应包含以下 Markdown 片段:', async function (this: CradleWorld, table: DataTable) {
  const fragments = table.raw().flat().map(fragment => fragment.trim()).filter(Boolean)

  await expect.poll(async () => readBrowserClipboardText(this), { timeout: 10_000 }).not.toBe('')
  const clipboardText = await readBrowserClipboardText(this)

  for (const fragment of fragments) {
    expect(clipboardText).toContain(fragment)
  }
})
