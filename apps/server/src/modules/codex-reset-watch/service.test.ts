import { afterEach, describe, expect, it } from 'vitest'

import * as BackgroundActivity from '../background-activity/service'
import * as Maintenance from '../maintenance/service'
import {
  projectCodexResetFooterPresentation,
  registerCodexResetWatchMaintenance,
  resetCodexResetWatchCacheForTests,
  setCodexResetWatchFetchForTests,
} from './service'

afterEach(() => {
  Maintenance.reset()
  BackgroundActivity.reset()
  resetCodexResetWatchCacheForTests()
})

function status(input?: {
  latestResetAt?: string | null
  observedAt?: string
  expiresAt?: string
  sourceUrl?: string
}) {
  return {
    data: {
      latest_reset: input?.latestResetAt
        ? { id: 'reset-1', announced_at: input.latestResetAt }
        : null,
      active_watch: {
        level: 'elevated' as const,
        reset_chance_percent: 80,
        forecast_window: 'by end of Saturday',
        observed_at: input?.observedAt ?? '2026-08-29T05:38:31.000Z',
        expires_at: input?.expiresAt ?? '2026-08-30T07:00:00.000Z',
        source: {
          type: 'x_post' as const,
          url: input?.sourceUrl ?? 'https://x.com/example/status/1',
        },
      },
    },
    meta: { generated_at: '2026-08-29T05:44:25.762Z' },
  }
}

describe('codex reset watch footer projection', () => {
  it('fetches and publishes through the scheduled background activity', async () => {
    setCodexResetWatchFetchForTests(async () => new Response(JSON.stringify(status({
      expiresAt: '2099-08-30T07:00:00.000Z',
    })), {
      status: 200,
      headers: { 'content-type': 'application/json', 'etag': '"watch-1"' },
    }))
    registerCodexResetWatchMaintenance()

    const result = await BackgroundActivity.requestRun('codex-reset-watch', 'refresh-status')

    expect(result.status).toBe('succeeded')
    expect(result.presentation.footer?.id).toBe(
      'codex-reset-watch:https://x.com/example/status/1',
    )
    expect(result.presentation.footer?.description).toMatch(/^80% chance by /)
  })

  it('projects a stable persistent notice while a watch is active', () => {
    expect(projectCodexResetFooterPresentation(
      status(),
      Date.parse('2026-08-29T06:00:00.000Z'),
      'Asia/Singapore',
    )).toEqual({
      id: 'codex-reset-watch:https://x.com/example/status/1',
      title: 'Codex reset watch',
      description: '80% chance by Aug 30, 3:00 PM GMT+8',
      actionLabel: 'View source',
      actionUrl: 'https://x.com/example/status/1',
      expiresAt: Date.parse('2026-08-30T07:00:00.000Z'),
    })
  })

  it('stops presenting after a newer reset announcement', () => {
    const result = projectCodexResetFooterPresentation(
      status({ latestResetAt: '2026-08-29T06:30:00.000Z' }),
      Date.parse('2026-08-29T07:00:00.000Z'),
    )
    expect(result).toBeNull()
  })

  it('stops presenting when the watch expires', () => {
    const result = projectCodexResetFooterPresentation(
      status(),
      Date.parse('2026-08-30T07:00:00.000Z'),
    )
    expect(result).toBeNull()
  })
})
