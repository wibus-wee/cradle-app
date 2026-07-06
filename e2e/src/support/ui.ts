import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

import type { CradleWorld } from './world'

export const NEW_CHAT_ENTRY_SELECTOR = '[data-testid="new-chat-page"], [data-testid="home-dashboard"]'
export const NEW_CHAT_TEXTBOX_SELECTOR = '[data-testid="new-chat-textarea"], [data-testid="home-textarea"]'
export const NEW_CHAT_SEND_SELECTOR = '[data-testid="new-chat-send-btn"], [data-testid="home-send-btn"]'
export const NEW_CHAT_WORKSPACE_SELECTOR = '[data-testid="new-chat-workspace-selector"], [data-testid="home-workspace-selector"]'

export function visibleNewChatEntry(world: CradleWorld): Locator {
  return world.page.locator(NEW_CHAT_ENTRY_SELECTOR).filter({ visible: true }).first()
}

export async function waitForNewChatReady(world: CradleWorld, timeout = 30_000): Promise<Locator> {
  const entry = visibleNewChatEntry(world)
  await expect(entry).toBeVisible({ timeout })
  await expect(entry).toHaveAttribute('data-new-chat-ready', 'true', { timeout })
  return entry
}

export function newChatTextBox(entry: Locator): Locator {
  return entry.locator(NEW_CHAT_TEXTBOX_SELECTOR).first()
}

export function newChatSendButton(entry: Locator): Locator {
  return entry.locator(NEW_CHAT_SEND_SELECTOR).first()
}

export function newChatWorkspaceSelector(entry: Locator): Locator {
  return entry.locator(NEW_CHAT_WORKSPACE_SELECTOR).first()
}

export function visibleChatView(world: CradleWorld): Locator {
  return world.page.locator('[data-testid="chat-view"]').filter({ visible: true }).first()
}

export function visibleProviderModelSelector(world: CradleWorld): Locator {
  return world.page.locator('[data-testid="provider-model-selector"]').filter({ visible: true }).first()
}

export function visibleRuntimeSelector(world: CradleWorld): Locator {
  return world.page.locator('[data-testid="runtime-selector"]').filter({ visible: true }).first()
}

export async function fillPromptEditor(editor: Locator, text: string): Promise<void> {
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await editor.click()
  await editor.fill(text)
}

export async function expectPromptEditorToContain(editor: Locator, expected: string | RegExp, timeout = 10_000): Promise<void> {
  await expect(editor).toContainText(expected, { timeout })
}
