import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const JARVIS_TIMEOUT = 10_000
const JARVIS_RESPONSE_TIMEOUT = 30_000

function jarvisPopover(world: CradleWorld) {
  return world.page.locator('[data-testid="jarvis-popover"]')
}

When('我打开 Jarvis 面板', async function (this: CradleWorld) {
  const trigger = this.page.locator('[data-testid="ask-jarvis-button"]')
  await expect(trigger).toBeVisible({ timeout: JARVIS_TIMEOUT })
  await trigger.focus()
  await this.page.keyboard.press('Enter')
})

When('我关闭 Jarvis 面板', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)
  await expect(panel).toBeVisible({ timeout: JARVIS_TIMEOUT })
  await panel.getByRole('button', { name: 'Close' }).click()
})

When('我在 Jarvis 面板输入{string}', async function (this: CradleWorld, text: string) {
  const panel = jarvisPopover(this)
  const input = panel.getByLabel('Jarvis message')

  await expect(panel).toBeVisible({ timeout: JARVIS_TIMEOUT })
  await expect(input).toBeEnabled({ timeout: JARVIS_TIMEOUT })
  await input.fill(text)
})

When('我发送 Jarvis 消息', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)
  const button = panel.getByRole('button', { name: 'Send' })

  await expect(button).toBeEnabled({ timeout: JARVIS_TIMEOUT })
  await button.click()
})

Then('我应该看到 Jarvis 面板', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)
  await expect(panel).toBeVisible({ timeout: JARVIS_TIMEOUT })
  await expect(panel).toHaveAttribute('data-jarvis-ready', 'true', { timeout: JARVIS_TIMEOUT })
})

Then('Jarvis 面板应提示尚未配置 profile', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)
  await expect(panel).toContainText('No profile configured', { timeout: JARVIS_TIMEOUT })
  await expect(panel).toContainText('Go to Settings', { timeout: JARVIS_TIMEOUT })
})

Then('Jarvis 输入框应处于禁用状态', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)
  const input = panel.getByPlaceholder('Configure a profile in Settings → Jarvis')
  await expect(input).toBeVisible({ timeout: JARVIS_TIMEOUT })
  await expect(input).toBeDisabled({ timeout: JARVIS_TIMEOUT })
  await expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled({ timeout: JARVIS_TIMEOUT })
})

Then('Jarvis 输入框应处于可用状态', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)
  const input = panel.getByPlaceholder('Ask Jarvis...')

  await expect(input).toBeVisible({ timeout: JARVIS_TIMEOUT })
  await expect(input).toBeEnabled({ timeout: JARVIS_TIMEOUT })
})

Then('Jarvis 面板应显示用户消息{string}', async function (this: CradleWorld, text: string) {
  const panel = jarvisPopover(this)

  await expect(panel.locator('[data-testid="message-bubble-user"]').filter({ hasText: text })).toBeVisible({ timeout: JARVIS_RESPONSE_TIMEOUT })
})

Then('Jarvis 面板应显示 AI 回复', async function (this: CradleWorld) {
  const panel = jarvisPopover(this)

  await expect(panel.locator('[data-testid="message-bubble-assistant"]').first()).toBeVisible({ timeout: JARVIS_RESPONSE_TIMEOUT })
})

Then('Jarvis 面板不应显示', async function (this: CradleWorld) {
  await expect(jarvisPopover(this)).toBeHidden({ timeout: JARVIS_TIMEOUT })
})
