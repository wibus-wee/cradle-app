import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { UsageRangeKey } from '../support/pages/usage'
import type { CradleWorld } from '../support/world'

const USAGE_CSV = 'usage.downloaded-csv'

When('我打开 Usage', async function (this: CradleWorld) {
  await this.usagePage.open()
})

Then('Usage 应显示精确的 {int} tokens 与 {int} turn', async function (
  this: CradleWorld,
  tokens: number,
  turns: number,
) {
  await expect.poll(async () => {
    const response = await fetch(`${this.params.serverUrl}/usage/summary`)
    if (!response.ok) {
      return null
    }
    const summary = await response.json() as { totalTokens: number, totalTurns: number }
    return [summary.totalTokens, summary.totalTurns]
  }, { timeout: 30_000 }).toEqual([tokens, turns])
  await this.usagePage.expectExactTotals(tokens, turns)
})

When('我将 Usage 时间范围切换为{string}', async function (this: CradleWorld, range: UsageRangeKey) {
  await this.usagePage.selectRange(range)
})

Then('Usage 时间范围{string}应被选中', async function (this: CradleWorld, range: UsageRangeKey) {
  await this.usagePage.expectRange(range)
})

When('我导出 Usage CSV', async function (this: CradleWorld) {
  this.remember(USAGE_CSV, await this.usagePage.exportCsv())
})

Then('Usage CSV 应包含精确的 {int} tokens 与 {int} turn', function (
  this: CradleWorld,
  tokens: number,
  turns: number,
) {
  const download = this.recall<{ fileName: string, content: string }>(USAGE_CSV)
  expect(download.fileName).toMatch(/^cradle-usage-90d-\d{4}-\d{2}-\d{2}\.csv$/)
  const rows = download.content.trim().split('\n')
  expect(rows[0]).toBe('date,prompt_tokens,completion_tokens,total_tokens,turns,cost_usd')
  expect(rows.slice(1).some((row) => {
    const columns = row.split(',')
    return Number(columns[3]) === tokens && Number(columns[4]) === turns
  })).toBe(true)
})
