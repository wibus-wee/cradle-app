import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { dismissTransientOverlays } from '../overlays'
import {
  fillPromptEditor,
  newChatSendButton,
  newChatTextBox,
  newChatWorkspaceSelector,
  waitForNewChatReady,
} from '../ui'

const READY_TIMEOUT = 30_000
const CHAT_TIMEOUT = 30_000

export class NewChatPage {
  constructor(private readonly page: Page) {}

  private owner() {
    return { page: this.page }
  }

  async openFromNav(): Promise<void> {
    await dismissTransientOverlays(this.page)
    const navItem = this.page.locator('[data-testid="nav-new-chat"]')
    await expect(navItem).toBeVisible({ timeout: 15_000 })
    await navItem.click()
    await waitForNewChatReady(this.owner())
  }

  async waitReady() {
    return waitForNewChatReady(this.owner())
  }

  entry(): Locator {
    return this.page.locator('[data-testid="new-chat-page"], [data-testid="home-dashboard"]').filter({ visible: true }).first()
  }

  textBox(): Locator {
    return newChatTextBox(this.entry())
  }

  sendButton(): Locator {
    return newChatSendButton(this.entry())
  }

  workspaceSelector(): Locator {
    return newChatWorkspaceSelector(this.entry())
  }

  async fill(text: string): Promise<void> {
    await fillPromptEditor(this.textBox(), text)
  }

  async send(): Promise<void> {
    const button = this.sendButton()
    await expect(button).toBeEnabled({ timeout: READY_TIMEOUT })
    await button.click()
  }

  async selectRuntime(label: string | RegExp): Promise<void> {
    const selector = this.page.locator('[data-testid="runtime-selector"]').filter({ visible: true }).first()
    await expect(selector).toBeVisible({ timeout: 10_000 })
    const current = (await selector.textContent())?.trim() ?? ''
    const expected = typeof label === 'string' ? new RegExp(label, 'i') : label
    if (expected.test(current)) {
      return
    }
    await selector.click()
    const menu = this.page.locator('[role="menu"]').last()
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await menu.locator('[role="menuitem"]', { hasText: label }).first().click()
    await expect(selector).toContainText(expected, { timeout: 10_000 })
  }

  async selectProvider(label: string | RegExp): Promise<void> {
    const providerSelector = this.page.locator('[data-testid="provider-model-selector"]').filter({ visible: true }).first()
    const agentSelector = this.page.locator('[data-testid="agent-selector"]').filter({ visible: true }).first()
    const selector = await providerSelector.count() > 0 && await providerSelector.isVisible()
      ? providerSelector
      : agentSelector
    await expect(selector).toBeVisible({ timeout: 10_000 })
    await selector.click()
    const menu = this.page.locator('[role="menu"]').last()
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await menu.locator('[role="menuitem"]', { hasText: label }).first().click()
    await this.page.keyboard.press('Escape')
  }
}

export class ChatPage {
  constructor(private readonly page: Page) {}

  view(): Locator {
    return this.page.locator('[data-testid="chat-view"]').filter({ visible: true }).first()
  }

  async waitVisible(timeout = CHAT_TIMEOUT): Promise<Locator> {
    const view = this.view()
    await expect(view).toBeVisible({ timeout })
    return view
  }

  async waitStatus(status: string, timeout = CHAT_TIMEOUT): Promise<Locator> {
    const view = await this.waitVisible(timeout)
    await expect(view).toHaveAttribute('data-chat-status', status, { timeout })
    return view
  }

  async sessionId(): Promise<string> {
    const view = await this.waitVisible()
    const id = await view.getAttribute('data-chat-session-id')
    if (!id) {
      throw new Error('Expected chat view to expose data-chat-session-id')
    }
    return id
  }

  lastAssistantBubble(): Locator {
    return this.page.locator('[data-testid="message-bubble-assistant"]').last()
  }

  async expectAssistantVisible(timeout = CHAT_TIMEOUT): Promise<Locator> {
    const bubble = this.lastAssistantBubble()
    await expect(bubble).toBeVisible({ timeout })
    return bubble
  }

  async expectAssistantContains(text: string | RegExp, timeout = CHAT_TIMEOUT): Promise<void> {
    await expect(await this.expectAssistantVisible(timeout)).toContainText(text, { timeout })
  }

  async expectUserMessage(text: string | RegExp, timeout = CHAT_TIMEOUT): Promise<void> {
    await expect(this.page.locator('[data-testid="message-bubble-user"]').filter({ hasText: text }).last())
      .toBeVisible({ timeout })
  }

  errorBanner(): Locator {
    return this.page.locator('[data-testid="chat-error-banner"]')
  }

  async expectNoError(): Promise<void> {
    await expect(this.errorBanner()).toHaveCount(0)
  }

  /**
   * Prefer exact failure string in the chat error banner / transcript.
   */
  async expectErrorContains(
    text: string,
    options: { timeout?: number } = {},
  ): Promise<void> {
    const timeout = options.timeout ?? CHAT_TIMEOUT
    const view = await this.waitVisible(timeout)
    await expect.poll(async () => {
      const bannerText = (await this.errorBanner().textContent().catch(() => '')) ?? ''
      const viewText = (await view.textContent().catch(() => '')) ?? ''
      const combined = `${bannerText}\n${viewText}`
      return combined.includes(text)
    }, { timeout }).toBe(true)
  }

  stopButton(): Locator {
    return this.page.locator('[data-testid="chat-stop-btn"]')
  }

  async stop(): Promise<void> {
    const btn = this.stopButton()
    await expect(btn).toBeVisible({ timeout: CHAT_TIMEOUT })
    await btn.click()
  }

  async expectStopGone(timeout = CHAT_TIMEOUT): Promise<void> {
    await expect(this.stopButton()).toHaveCount(0, { timeout })
  }

  composer(): Locator {
    return this.page.locator('[data-testid="chat-composer-textarea"], [data-testid="chat-textarea"]')
      .filter({ visible: true })
      .first()
  }

  sendButton(): Locator {
    return this.page.locator('[data-testid="chat-send-btn"]').filter({ visible: true }).first()
  }

  async fillComposer(text: string): Promise<void> {
    await fillPromptEditor(this.composer(), text)
  }

  async sendFromComposer(): Promise<void> {
    const button = this.sendButton()
    await expect(button).toBeEnabled({ timeout: READY_TIMEOUT })
    await button.click()
  }

  async fillAndSend(text: string): Promise<void> {
    await this.fillComposer(text)
    await this.sendFromComposer()
  }

  sessionItem(sessionId: string): Locator {
    return this.page.locator(`[data-testid="session-item-${sessionId}"]`)
  }

  async waitForSessionInSidebar(sessionId: string, timeout = 10_000): Promise<void> {
    await expect(this.sessionItem(sessionId)).toBeVisible({ timeout })
  }

  async openSessionMenu(sessionId: string): Promise<void> {
    await dismissTransientOverlays(this.page)
    const item = this.sessionItem(sessionId)
    await expect(item).toBeVisible({ timeout: 10_000 })
    await item.hover()
    const trigger = this.page.locator(`[data-testid="session-menu-trigger-${sessionId}"]`)
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()
  }

  async clickSessionMenuAction(
    sessionId: string,
    action: 'toggle-pin' | 'copy-markdown' | 'archive' | 'rename',
  ): Promise<void> {
    const locator = this.page.locator(`[data-testid="session-menu-${action}-${sessionId}-context"]`)
    await expect(locator).toBeVisible({ timeout: 10_000 })
    await locator.click()
  }

  async expandExecutionDetails(assistantBubble?: Locator): Promise<Locator> {
    const bubble = assistantBubble ?? await this.expectAssistantVisible()
    const foldButton = bubble.getByRole('button', { name: 'Show execution details' })
    if (await foldButton.count() > 0) {
      await foldButton.click()
    }
    const worked = bubble.getByRole('button').filter({ hasText: /^Worked/ }).first()
    if (await worked.count() > 0) {
      const expanded = await worked.getAttribute('aria-expanded')
      if (expanded !== 'true') {
        await worked.click()
      }
    }
    return bubble
  }

  async openReasoningEntry(): Promise<Locator> {
    const bubble = await this.expandExecutionDetails()
    const legacy = bubble.locator('[data-testid="chat-reasoning-toggle"]').last()
    if (await legacy.count() > 0) {
      await expect(legacy).toBeVisible({ timeout: 10_000 })
      await legacy.click()
      return bubble
    }
    const feed = bubble.locator('[data-testid="chat-activity-feed"]').first()
    await expect(feed).toBeVisible({ timeout: 10_000 })
    const feedSummary = feed.locator('button').first()
    if (await feedSummary.count() > 0) {
      const expanded = await feedSummary.getAttribute('aria-expanded')
      if (expanded !== 'true') {
        await feedSummary.click()
      }
    }
    const reasoningRow = feed.getByRole('button').filter({ hasText: /Thought|Thinking|Reasoning/i }).first()
    await expect(reasoningRow).toBeVisible({ timeout: 10_000 })
    await reasoningRow.click()
    return bubble
  }

  async expectThoughtEntryVisible(): Promise<void> {
    const bubble = await this.expandExecutionDetails()
    const feed = bubble.locator('[data-testid="chat-activity-feed"]').first()
    await expect(feed).toBeVisible({ timeout: 10_000 })
    await expect(feed).toContainText(/Thought|Thinking|Reasoning/i, { timeout: 10_000 })
  }

  async expectReasoningContains(text: string): Promise<void> {
    const bubble = await this.expectAssistantVisible()
    await this.expandExecutionDetails(bubble)
    const legacy = bubble.locator('[data-testid="chat-reasoning-content"]').last()
    if (await legacy.count() > 0) {
      await expect(legacy).toBeVisible({ timeout: 10_000 })
      await expect(legacy).toContainText(text, { timeout: 10_000 })
      return
    }
    const feed = bubble.locator('[data-testid="chat-activity-feed"]').first()
    await expect(feed).toContainText(text, { timeout: 10_000 })
  }

  async expectActivityContains(text: string | RegExp, timeout = CHAT_TIMEOUT): Promise<void> {
    const bubble = await this.expectAssistantVisible(timeout)
    await this.expandExecutionDetails(bubble)
    const feed = bubble.locator('[data-testid="chat-activity-feed"]').first()
    await expect(feed).toBeVisible({ timeout })
    // Collapsed feed only shows the summary verb (e.g. "Explored 1 file").
    const feedSummary = feed.locator('button').first()
    if (await feedSummary.count() > 0) {
      const expanded = await feedSummary.getAttribute('aria-expanded')
      if (expanded !== 'true') {
        await feedSummary.click()
      }
    }
    await expect(feed).toContainText(text, { timeout })
  }

  async toolCallBlock(toolName: string): Promise<Locator> {
    const bubble = await this.expectAssistantVisible()
    let block = this.page.locator(`[data-testid^="chat-tool-call-"][data-tool-name="${toolName}"]`).first()
    if (await block.count() === 0) {
      await this.expandExecutionDetails(bubble)
      block = this.page.locator(`[data-testid^="chat-tool-call-"][data-tool-name="${toolName}"]`).first()
    }
    await expect(block).toBeVisible({ timeout: 10_000 })
    return block
  }
}

export class ApprovalPage {
  constructor(private readonly page: Page) {}

  card(): Locator {
    return this.page.locator('[data-testid="approval-card"]')
  }

  async waitVisible(timeout = 20_000): Promise<void> {
    await expect(this.card()).toBeVisible({ timeout })
  }

  async allow(): Promise<void> {
    await this.page.locator('[data-testid="approval-allow-btn"]').click()
  }

  async deny(): Promise<void> {
    await this.page.locator('[data-testid="approval-deny-btn"]').click()
  }

  async expectHidden(timeout = 20_000): Promise<void> {
    await expect(this.card()).toBeHidden({ timeout })
  }

  async expectContains(text: string | RegExp, timeout = 10_000): Promise<void> {
    await expect(this.card()).toContainText(text, { timeout })
  }
}
