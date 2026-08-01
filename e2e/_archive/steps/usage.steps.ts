import type { DataTable } from '@cucumber/cucumber'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const USAGE_TIMEOUT = 15_000

const DASHBOARD_VALUE_TEST_IDS: Record<string, string> = {
  '总 Tokens': 'usage-total-tokens',
  'Prompt Tokens': 'usage-pill-prompt-tokens-value',
  'Completion Tokens': 'usage-pill-completion-tokens-value',
  '总 Turns': 'usage-pill-total-turns-value',
  '今日 Tokens': 'usage-pill-today-tokens-value',
  '活跃天数': 'usage-pill-active-days-value',
}

function usageDashboard(world: CradleWorld) {
  return world.page.locator('[data-testid="usage-dashboard"]:visible').first()
}

function usageDashboardValue(world: CradleWorld, testId: string) {
  return usageDashboard(world).locator(`[data-testid="${testId}"]`).first()
}

When('我从侧栏打开 Usage Dashboard', async function (this: CradleWorld) {
  console.warn('[step] open usage dashboard from sidebar nav')
  const navItem = this.page.locator('[data-testid="nav-usage"]')

  await expect(navItem).toBeVisible({ timeout: USAGE_TIMEOUT })
  await navItem.click()
  await expect(usageDashboard(this)).toBeVisible({ timeout: USAGE_TIMEOUT })
})

Then('我应该看到 Usage Dashboard', async function (this: CradleWorld) {
  const dashboard = usageDashboard(this)

  await expect(dashboard).toBeVisible({ timeout: USAGE_TIMEOUT })
  await expect(dashboard.locator('[data-testid="usage-dashboard-title"]')).toHaveText('Usage', { timeout: USAGE_TIMEOUT })
})

Then('Usage Dashboard 应显示空状态', async function (this: CradleWorld) {
  await expect(usageDashboard(this).locator('[data-testid="usage-empty-state"]')).toBeVisible({ timeout: USAGE_TIMEOUT })
  await expect(usageDashboard(this).locator('[data-testid="usage-empty-state"]')).toContainText('No usage data yet', { timeout: USAGE_TIMEOUT })
})

Then('Usage Dashboard 应显示以下关键值:', async function (this: CradleWorld, table: DataTable) {
  for (const [label, expectedValue] of table.raw()) {
    const testId = DASHBOARD_VALUE_TEST_IDS[label]
    if (!testId) {
      throw new Error(`Unsupported usage dashboard value label: ${label}`)
    }

    await expect(usageDashboardValue(this, testId)).toHaveText(expectedValue, { timeout: USAGE_TIMEOUT })
  }
})

Then('Usage Dashboard Heatmap 今天的提示应显示{string}', async function (this: CradleWorld, expectedMetrics: string) {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dashboard = usageDashboard(this)
  const todayCell = dashboard.locator(`[data-testid="usage-heatmap-cell"][data-date="${today}"][data-has-usage="true"]`).first()

  await expect(todayCell).toBeVisible({ timeout: USAGE_TIMEOUT })
  await todayCell.hover()

  const tooltip = dashboard.locator('[data-testid="usage-heatmap-tooltip"]').first()
  await expect(tooltip).toBeVisible({ timeout: USAGE_TIMEOUT })
  await expect(tooltip.locator('[data-testid="usage-heatmap-tooltip-date"]')).toHaveText(today, { timeout: USAGE_TIMEOUT })
  await expect(tooltip.locator('[data-testid="usage-heatmap-tooltip-metrics"]')).toHaveText(expectedMetrics, { timeout: USAGE_TIMEOUT })
})
