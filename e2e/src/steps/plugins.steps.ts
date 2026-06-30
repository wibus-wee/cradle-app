// Drives plugin panel E2E flows through the real sidebar and plugin-host UI.
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const SYSTEM_INFO_PANEL_LINK = '[data-testid="plugin-panel-link-system-info"]'

function systemInfoPanel(world: CradleWorld) {
  return world.page.locator('[data-testid="plugin-panel-system-info"]').filter({ visible: true }).first()
}

async function assertSystemInfoPanelVisible(world: CradleWorld): Promise<void> {
  const panel = systemInfoPanel(world)
  await expect(panel).toContainText('System Info', { timeout: 15_000 })
  await expect(panel).toContainText('Hostname', { timeout: 15_000 })
  await expect(panel).toContainText('Platform', { timeout: 15_000 })
  await expect(panel).toContainText('Memory', { timeout: 15_000 })
}

When('我打开 System Info 插件面板', async function (this: CradleWorld) {
  const link = this.page.locator(SYSTEM_INFO_PANEL_LINK)
  await expect(link).toBeVisible({ timeout: 15_000 })
  await link.click()
})

When('我刷新 System Info 面板', async function (this: CradleWorld) {
  const panel = systemInfoPanel(this)
  const refreshButton = panel.getByRole('button', { name: 'Refresh' })
  await expect(refreshButton).toBeVisible({ timeout: 15_000 })
  await refreshButton.click()
})

When('我点击首页导航项', async function (this: CradleWorld) {
  const homeTabPill = this.page.locator('[data-testid="surface-pill-home"]')
  await expect(homeTabPill).toBeVisible({ timeout: 15_000 })
  await homeTabPill.click()
})

Then('System Info 面板应显示系统信息', async function (this: CradleWorld) {
  await assertSystemInfoPanelVisible(this)
})

Then('System Info 面板应继续显示系统信息', async function (this: CradleWorld) {
  await assertSystemInfoPanelVisible(this)
})
