import { describe, expect, it } from 'vitest'

import { buildUsageCsv } from './usage-export'
import type { DailyCost, DailyUsage } from './use-usage-overview'

describe('buildUsageCsv', () => {
  it('exports the selected range and combines per-model daily cost', () => {
    const today = new Date()
    const recent = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-')
    const daily: DailyUsage[] = [
      { date: '2020-01-01', promptTokens: 1, completionTokens: 2, totalTokens: 3, count: 1 },
      { date: recent, promptTokens: 10, completionTokens: 5, totalTokens: 15, count: 2 },
    ]
    const dailyCost = [
      { date: recent, modelId: 'a', costUsd: 0.1 },
      { date: recent, modelId: 'b', costUsd: 0.2 },
    ] as DailyCost[]

    expect(buildUsageCsv(daily, dailyCost, '7d')).toBe([
      'date,prompt_tokens,completion_tokens,total_tokens,turns,cost_usd',
      `${recent},10,5,15,2,0.300000`,
    ].join('\n'))
  })
})
