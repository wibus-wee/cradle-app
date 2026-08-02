import { describe, expect, it, vi } from 'vitest'

import { uiActivityBus } from '~/features/activity/activity-bus'
import type { UiActivityEvent } from '~/features/activity/types'

vi.mock('./client', () => ({
  trackProductEvent: vi.fn(),
}))

vi.mock('~/lib/electron', () => ({
  isTearoffWindow: false,
  isElectron: false,
  platform: 'web',
}))

describe('activity analytics sink', () => {
  it('emits only privacy-safe properties without raw entity strings', async () => {
    const { trackProductEvent } = await import('./client')
    const { installActivityAnalyticsSink } = await import('./activity-analytics-sink')
    const track = vi.mocked(trackProductEvent)
    track.mockClear()

    uiActivityBus.start({ idleTimeoutMs: 60_000 })
    const disposable = installActivityAnalyticsSink()

    const started: UiActivityEvent = {
      kind: 'ui.segment.started',
      occurredAt: 1,
      entity: 'apps/web/src/secret-path.ts',
      entityType: 'file',
      previousEntity: null,
      previousEntityType: null,
    }
    // Dispatch via host subscription path by using bus internal — call sink through bus
    uiActivityBus.setResolvedEntity({
      entity: 'apps/web/src/secret-path.ts',
      entityType: 'file',
    })
    uiActivityBus.setResolvedEntity({
      entity: 'chat:other',
      entityType: 'chat',
    })

    expect(track).toHaveBeenCalledWith('activity_segment_started', {
      entity_type: 'file',
      previous_entity_type: null,
    })
    expect(track).toHaveBeenCalledWith('activity_segment_ended', {
      entity_type: 'file',
      duration_bucket: expect.any(String),
      end_reason: 'entity-changed',
    })

    for (const call of track.mock.calls) {
      const payload = JSON.stringify(call[1])
      expect(payload).not.toContain('secret-path')
      expect(payload).not.toContain('apps/web')
    }

    void started
    disposable.dispose()
    uiActivityBus.stop()
  })

  it('skips activity analytics in tearoff windows', async () => {
    vi.resetModules()
    vi.doMock('~/lib/electron', () => ({
      isTearoffWindow: true,
      isElectron: false,
      platform: 'web',
    }))
    vi.doMock('./client', () => ({
      trackProductEvent: vi.fn(),
    }))

    const { trackProductEvent } = await import('./client')
    const { installActivityAnalyticsSink } = await import('./activity-analytics-sink')
    const { uiActivityBus: bus } = await import('~/features/activity/activity-bus')
    const track = vi.mocked(trackProductEvent)
    track.mockClear()

    bus.start({ idleTimeoutMs: 60_000 })
    const disposable = installActivityAnalyticsSink()
    bus.setResolvedEntity({ entity: 'chat:abc', entityType: 'chat' })
    expect(track).not.toHaveBeenCalled()
    disposable.dispose()
    bus.stop()
  })
})
