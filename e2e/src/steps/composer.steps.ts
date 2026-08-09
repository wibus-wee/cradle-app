import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { fillPromptEditor, newChatTextBox, visibleNewChatEntry } from '../support/ui'
import type { CradleWorld } from '../support/world'

Then('Composer 应显示 bang 命令预览', async function (this: CradleWorld) {
  const indicator = this.page.locator('[data-testid="chat-bang-command-indicator"]').filter({ visible: true }).first()
  await expect(indicator).toBeVisible({ timeout: 10_000 })
})

Then('聊天视图应显示 bang 结果，包含{string}', async function (this: CradleWorld, text: string) {
  const result = this.page.locator('[data-testid="chat-bang-command-result"]').first()
  await expect(result).toBeVisible({ timeout: 30_000 })
  await expect(result).toContainText(text, {
    timeout: 30_000,
  })
})

// Keep a thin alias used by archived features if revived.
When('我在 Composer 中输入{string}', async function (this: CradleWorld, text: string) {
  const entry = visibleNewChatEntry(this)
  const chatComposer = this.page.locator('[data-testid="chat-composer-textarea"]').filter({ visible: true }).first()
  if (await chatComposer.isVisible().catch(() => false)) {
    await fillPromptEditor(chatComposer, text)
    return
  }
  await fillPromptEditor(newChatTextBox(entry), text)
})
