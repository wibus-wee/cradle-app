import type { DataTable } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  anthropicHttpErrorExchange,
  anthropicScenario,
  anthropicTextExchange,
  anthropicThinkingTextExchange,
  anthropicToolUseExchange,
} from '../scenarios/anthropic'
import { openAiTextExchange } from '../scenarios/openai'
import { expectPromptEditorToContain } from '../ui'
import type { CradleWorld } from '../world'

export const DEFAULT_RESPONSE = 'Hello from E2E simulator!'
const MULTI_TURN_RESPONSES = [
  '第一轮助手：已记住苹果',
  '第二轮助手：你让我记住了苹果',
]
const SLOW_RESPONSE = '慢速助手回复完成'
const SLOW_GATE = 'e2e-slow-stream'
export const CHAT_STATUS_TIMEOUT = 30_000
const SESSION_ALIASES_KEY = 'chat.session-aliases'
const SELECTED_NEW_CHAT_WORKSPACE_KEY = 'chat.selected-new-chat-workspace'
const PREFERRED_RUNTIME_KEY = 'chat.preferred-runtime'

type SessionAlias = {
  id: string
  firstUserText: string
}

type PreferredChatRuntime = 'standard' | 'claude-agent' | 'codex'

function requireSimulator(world: CradleWorld) {
  if (!world.simulator) {
    throw new Error('Expected simulator to be configured')
  }
  return world.simulator
}

function recallPreferredChatRuntime(world: CradleWorld): PreferredChatRuntime {
  return world.maybeRecall<PreferredChatRuntime>(PREFERRED_RUNTIME_KEY) ?? 'standard'
}

function recallSessionAliases(world: CradleWorld): Record<string, SessionAlias> {
  return world.maybeRecall<Record<string, SessionAlias>>(SESSION_ALIASES_KEY) ?? {}
}

function rememberSessionAlias(world: CradleWorld, alias: string, session: SessionAlias): void {
  world.remember(SESSION_ALIASES_KEY, {
    ...recallSessionAliases(world),
    [alias]: session,
  })
}

export function recallSessionAlias(world: CradleWorld, alias: string): SessionAlias {
  const session = recallSessionAliases(world)[alias]

  if (!session) {
    throw new Error(`Missing remembered chat session alias: ${alias}`)
  }

  return session
}

export async function configureMultiTurnClaudeAgentSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure multi-turn Claude Agent simulator')
  await world.configureClaudeAgentChat({ mode: 'text', text: MULTI_TURN_RESPONSES[0] })
  world.remember('simulator.next-replies', [
    MULTI_TURN_RESPONSES[1]!,
    '会话助手回复',
    '会话助手回复',
  ])
}

export async function configureSlowGatedClaudeAgentSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure slow gated Claude Agent simulator')
  await world.configureClaudeAgentChat({ mode: 'text', text: SLOW_RESPONSE })
  const simulator = requireSimulator(world)
  simulator.reset()
  world.enqueue(anthropicScenario([
    anthropicTextExchange({ label: 'slow', text: SLOW_RESPONSE, gateAfterStart: SLOW_GATE }),
  ]))
  world.remember('simulator.slow-gate', SLOW_GATE)
}

export async function configureFailingClaudeAgentSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure failing Claude Agent simulator')
  await world.configureClaudeAgentChat({ mode: 'text' })
  requireSimulator(world).reset()
  world.enqueue(anthropicScenario([
    anthropicHttpErrorExchange({
      label: 'fail-provider',
      message: 'E2E simulator forced failure',
      bodyTextIncludes: '请触发 provider 错误',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
}

export async function configureThinkingClaudeAgentSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure thinking Claude Agent simulator')
  await world.configureClaudeAgentChat({ mode: 'text' })
  requireSimulator(world).reset()
  world.enqueue(anthropicScenario([
    anthropicThinkingTextExchange({
      label: 'thinking',
      thinking: '第一步分析问题\n第二步形成答案',
      text: DEFAULT_RESPONSE,
      bodyTextIncludes: '请先思考再回答',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
}

export async function configureClaudeApprovalSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Claude Agent approval simulator')
  await world.configureClaudeAgentChat({ mode: 'approval' })
}

export async function configureDefaultAiReply(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Codex simulator (real app-server → OpenAI Responses)')
  await world.configureCodexChat({ texts: ['Hello from Codex E2E simulator!'] })
}

export async function configureReadToolLoopSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Claude Agent Read tool-loop simulator')
  await world.configureClaudeAgentChat({ mode: 'text' })
  requireSimulator(world).reset()
  const excludeTitle = 'You are naming a Claude Agent task session'
  const toolUseId = 'toolu_e2e_read_agents'
  world.enqueue(anthropicScenario([
    anthropicToolUseExchange({
      label: 'tool-read',
      toolUseId,
      toolName: 'Read',
      toolInput: { file_path: 'AGENTS.md' },
      bodyTextIncludes: '请读取 AGENTS.md',
      bodyTextExcludes: excludeTitle,
    }),
    anthropicTextExchange({
      label: 'tool-final',
      text: '工具环完成：已读取 AGENTS.md',
      bodyTextIncludes: toolUseId,
      bodyTextExcludes: excludeTitle,
    }),
  ]))
}

export async function configureCodexMultiTurnSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Codex multi-turn simulator')
  await world.configureCodexChat({
    texts: ['Codex 第一轮：已记住香蕉'],
  })
  world.remember('simulator.next-replies', [
    'Codex 第二轮：你让我记住了香蕉',
  ])
}

export async function navigateToNewChatWithSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] navigate to new-chat page')
  await world.newChat.openFromNav()

  if (recallPreferredChatRuntime(world) === 'claude-agent') {
    await selectClaudeAgentSimulator(world)
    return
  }

  await world.newChat.selectRuntime('Agents')
  const preferredProvider = world.maybeRecall<string>('chat.preferred-provider')
  if (preferredProvider) {
    await world.newChat.selectProvider(new RegExp(preferredProvider, 'i'))
  }
}

export async function selectClaudeAgentSimulator(world: CradleWorld): Promise<void> {
  await world.newChat.selectRuntime('Claude Agent')
  await world.newChat.selectProvider(/E2E Claude Agent/i)
}

export async function selectCodexSimulator(world: CradleWorld): Promise<void> {
  await world.newChat.selectRuntime('Codex')
  await world.newChat.selectProvider(/E2E Codex/i)
}

export async function releaseSlowStreamGate(world: CradleWorld): Promise<void> {
  const gate = world.recall<string>('simulator.slow-gate')
  const simulator = requireSimulator(world)
  await simulator.waitForGate(gate)
  simulator.release(gate)
}

export function clearPendingScriptedReplies(world: CradleWorld): void {
  world.remember('simulator.next-replies', [] as string[])
}

export function assertSimulatorExhausted(world: CradleWorld): void {
  clearPendingScriptedReplies(world)
  world.assertSimulatorExhausted()
}

export async function createRememberedSession(
  world: CradleWorld,
  alias: string,
  firstUserText: string,
): Promise<SessionAlias> {
  await navigateToNewChatWithSimulator(world)
  await world.newChat.fill(firstUserText)

  if (Object.keys(recallSessionAliases(world)).length > 0) {
    await enqueueNextScriptedReply(world, '会话助手回复')
  }

  await world.newChat.send()
  await world.chat.waitStatus('idle')
  await world.page.waitForTimeout(100)

  const session = {
    id: await world.chat.sessionId(),
    firstUserText,
  }
  rememberSessionAlias(world, alias, session)
  await world.chat.waitForSessionInSidebar(session.id)
  return session
}

export async function enqueueNextScriptedReply(world: CradleWorld, fallbackText?: string): Promise<void> {
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
  if (['codex', 'standard'].includes(recallPreferredChatRuntime(world))) {
    world.enqueueOpenAi(openAiTextExchange({
      label: `scripted-openai-${Date.now()}`,
      text: next,
    }))
    return
  }
  world.enqueue(anthropicScenario([
    anthropicTextExchange({ label: `scripted-${Date.now()}`, text: next }),
  ]))
}

export async function fillChatComposerWithNextReply(world: CradleWorld, text: string): Promise<void> {
  await enqueueNextScriptedReply(world)
  await world.chat.waitVisible()
  await world.chat.fillComposer(text)
}

export async function expectPromptContains(world: CradleWorld, text: string): Promise<void> {
  await expectPromptEditorToContain(world.newChat.textBox(), new RegExp(text))
}

export async function selectNewChatWorkspace(world: CradleWorld, ordinal: number): Promise<void> {
  const selector = world.newChat.workspaceSelector()
  await expect(selector).toBeVisible({ timeout: 10_000 })
  await selector.click()

  const option = world.page.locator('[data-testid^="new-chat-workspace-option-"]').nth(ordinal - 1)
  await expect(option).toBeVisible({ timeout: 10_000 })

  const workspaceName = (await option.textContent())?.trim()
  if (!workspaceName) {
    throw new Error(`Workspace option ${ordinal} did not expose a visible name`)
  }

  await option.click()
  await expect(selector).toContainText(workspaceName, { timeout: 10_000 })
  world.remember(SELECTED_NEW_CHAT_WORKSPACE_KEY, workspaceName)
}

export async function expectCurrentSessionUnderSelectedWorkspace(world: CradleWorld): Promise<void> {
  const workspaceName = world.recall<string>(SELECTED_NEW_CHAT_WORKSPACE_KEY)
  const sessionId = await world.chat.sessionId()
  const workspaceGroup = world.page.locator('[data-testid^="workspace-group-"]').filter({ hasText: workspaceName }).first()

  await expect(workspaceGroup).toBeVisible({ timeout: 10_000 })
  await expect(workspaceGroup.locator(`[data-testid="session-item-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
}

export async function expectDefaultAiReply(world: CradleWorld): Promise<void> {
  await world.chat.waitStatus('idle')
  await world.chat.expectAssistantContains(DEFAULT_RESPONSE)
  await world.chat.expectNoError()
}

export async function expectSidebarSessionOrder(
  world: CradleWorld,
  firstAlias: string,
  secondAlias: string,
): Promise<void> {
  const firstSessionId = recallSessionAlias(world, firstAlias).id
  const secondSessionId = recallSessionAlias(world, secondAlias).id

  await expect.poll(async () => {
    const order = await world.page.locator('[data-testid^="session-item-"]').filter({ visible: true }).evaluateAll((elements) => {
      return elements.flatMap((element) => {
        const value = element.getAttribute('data-testid')?.replace('session-item-', '')
        return value ? [value] : []
      })
    })
    return order.includes(firstSessionId)
      && order.includes(secondSessionId)
      && order.indexOf(firstSessionId) < order.indexOf(secondSessionId)
  }, { timeout: 10_000 }).toBe(true)
}

export async function expectChatStreaming(world: CradleWorld): Promise<void> {
  await world.chat.waitStatus('streaming')
  await expect(world.chat.stopButton()).toBeVisible({ timeout: 10_000 })
  await world.chat.expectAssistantVisible(CHAT_STATUS_TIMEOUT)
}

export async function renameRememberedSession(
  world: CradleWorld,
  alias: string,
  nextTitle: string,
): Promise<void> {
  const sessionId = recallSessionAlias(world, alias).id
  const input = world.page.locator(`[data-testid="session-rename-input-${sessionId}"]`)

  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(nextTitle)
  await input.press('Enter')
  await expect(input).toHaveCount(0, { timeout: 10_000 })
}

export async function expectSessionPinned(world: CradleWorld, alias: string): Promise<void> {
  const sessionId = recallSessionAlias(world, alias).id
  const item = world.chat.sessionItem(sessionId)

  await expect(item).toHaveAttribute('data-session-pinned', 'true', { timeout: 10_000 })
  await expect(world.page.locator(`[data-testid="session-pin-indicator-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
}

export async function expectSessionUnpinned(world: CradleWorld, alias: string): Promise<void> {
  const sessionId = recallSessionAlias(world, alias).id
  const item = world.chat.sessionItem(sessionId)

  await expect(item).toHaveAttribute('data-session-pinned', 'false', { timeout: 10_000 })
  await expect(item.locator(`[data-testid="session-pin-indicator-${sessionId}"]`)).toHaveCount(0)
}

export async function expectSessionTitle(world: CradleWorld, alias: string, expectedTitle: string): Promise<void> {
  const sessionId = recallSessionAlias(world, alias).id
  await expect(world.page.locator(`[data-testid="session-title-${sessionId}"]`)).toHaveText(expectedTitle, { timeout: 10_000 })
}

export async function clearBrowserClipboard(world: CradleWorld): Promise<void> {
  await world.page.evaluate(() => navigator.clipboard.writeText(''))
}

async function readBrowserClipboardText(world: CradleWorld): Promise<string> {
  return world.page.evaluate(() => navigator.clipboard.readText())
}

export async function expectClipboardContainsMarkdownFragments(world: CradleWorld, table: DataTable): Promise<void> {
  const fragments = table.raw().flat().map(fragment => fragment.trim()).filter(Boolean)

  await expect.poll(async () => readBrowserClipboardText(world), { timeout: 10_000 }).not.toBe('')
  const clipboardText = await readBrowserClipboardText(world)

  for (const fragment of fragments) {
    expect(clipboardText).toContain(fragment)
  }
}

export async function openToolCall(world: CradleWorld, toolName: string): Promise<void> {
  const block = await world.chat.toolCallBlock(toolName)
  const toggle = block.locator('[data-testid^="chat-tool-call-toggle-"]').first()
  if (await toggle.count() === 0) {
    return
  }
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  await toggle.click()
  await expect(block.locator('[data-testid^="chat-tool-call-content-"]').first()).toBeVisible({ timeout: 10_000 })
}

export async function expectToolCallContains(world: CradleWorld, toolName: string, text: string): Promise<void> {
  await expect(await world.chat.toolCallBlock(toolName)).toContainText(text, { timeout: 10_000 })
}
