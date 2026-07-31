import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

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
    const selector = this.page.locator('[data-testid="provider-model-selector"]').filter({ visible: true }).first()
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

  async expectAssistantContains(text: string | RegExp, timeout = CHAT_TIMEOUT): Promise<void> {
    await expect(this.lastAssistantBubble()).toContainText(text, { timeout })
  }

  async expectUserMessage(text: string | RegExp, timeout = CHAT_TIMEOUT): Promise<void> {
    await expect(this.page.locator('[data-testid="message-bubble-user"]').filter({ hasText: text }).last())
      .toBeVisible({ timeout })
  }

  async expectNoError(timeout = 5_000): Promise<void> {
    await expect(this.page.locator('[data-testid="chat-error"]')).toHaveCount(0, { timeout })
  }

  async expectErrorContains(text: string | RegExp, timeout = CHAT_TIMEOUT): Promise<void> {
    await expect(this.page.locator('[data-testid="chat-error"]')).toContainText(text, { timeout })
  }

  stopButton(): Locator {
    return this.page.locator('[data-testid="chat-stop-btn"]')
  }

  async stop(): Promise<void> {
    const btn = this.stopButton()
    await expect(btn).toBeVisible({ timeout: CHAT_TIMEOUT })
    await btn.click()
  }

  composer(): Locator {
    return this.page.locator('[data-testid="chat-textarea"]').filter({ visible: true }).first()
  }

  sendButton(): Locator {
    return this.page.locator('[data-testid="chat-send-btn"]').filter({ visible: true }).first()
  }

  async fillAndSend(text: string): Promise<void> {
    await fillPromptEditor(this.composer(), text)
    const button = this.sendButton()
    await expect(button).toBeEnabled({ timeout: READY_TIMEOUT })
    await button.click()
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
}
