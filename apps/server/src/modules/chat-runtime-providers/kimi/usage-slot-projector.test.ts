import { describe, expect, it } from 'vitest'

import { projectKimiOauthUsageSlotState } from './usage-slot-projector'

describe('projectKimiOauthUsageSlotState', () => {
  it('projects the current oauth usage shape into the usage UI slot', () => {
    const state = projectKimiOauthUsageSlotState({
      threadId: 'kimi-session-1',
      updatedAt: 1_700_000_000_000,
      data: {
        kind: 'ok',
        summary: {
          name: 'Weekly',
          limit: 100,
          used: 40,
          reset_at: '2026-08-10T00:00:00.000Z',
          window: { duration: 1, unit: 'week' },
        },
        limits: [
          {
            name: 'Daily',
            limit: 20,
            used: 10,
            reset_at: '2026-08-03T00:00:00.000Z',
            window: { duration: 1, unit: 'day' },
          },
        ],
        extra_usage: {
          balance_cents: 1250,
          currency: 'USD',
          monthly_charge_limit_cents: 5000,
          monthly_charge_limit_enabled: true,
          monthly_used_cents: 300,
          total_cents: 1250,
        },
      },
    })

    expect(state).toEqual({
      kind: 'usage',
      slotId: 'kimi:usage',
      threadId: 'kimi-session-1',
      limitName: 'Weekly',
      usedPercent: 40,
      primaryWindowDurationMins: 10_080,
      primaryResetsAt: Math.floor(Date.parse('2026-08-10T00:00:00.000Z') / 1_000),
      secondaryUsedPercent: 50,
      secondaryWindowDurationMins: 1_440,
      secondaryResetsAt: Math.floor(Date.parse('2026-08-03T00:00:00.000Z') / 1_000),
      creditsBalance: '12.50 USD',
      hasCredits: true,
      rateLimitReachedType: null,
      planType: null,
      updatedAt: 1_700_000_000_000,
    })
  })

  it('accepts the legacy label/reset_hint usage fields', () => {
    const state = projectKimiOauthUsageSlotState({
      threadId: 'kimi-session-2',
      data: {
        kind: 'ok',
        summary: {
          label: 'Legacy weekly',
          limit: 50,
          used: 25,
          reset_hint: 'resets Monday',
        },
        limits: [],
        extra_usage: null,
      },
    })

    expect(state).toMatchObject({
      slotId: 'kimi:usage',
      limitName: 'Legacy weekly',
      usedPercent: 50,
      primaryWindowDurationMins: null,
      primaryResetsAt: null,
      creditsBalance: null,
      hasCredits: null,
    })
  })

  it('returns null for error payloads', () => {
    expect(projectKimiOauthUsageSlotState({
      threadId: 'kimi-session-3',
      data: { kind: 'error', message: 'unauthorized' },
    })).toBeNull()
  })
})
