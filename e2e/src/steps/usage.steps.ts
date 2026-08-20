import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

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
