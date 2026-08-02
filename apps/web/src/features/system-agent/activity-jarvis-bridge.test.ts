import { describe, expect, it, vi } from 'vitest'

import { uiActivityBus } from '~/features/activity/activity-bus'
import { formatObservationText } from '~/lib/web-activity-registry'

import {
  clearRecentAmbientObservationTextsForTests,
  installJarvisActivityBridge,
  readRecentAmbientObservationTexts,
} from './activity-jarvis-bridge'

vi.mock('./jarvis-ambient-session', async () => {
  const actual = await vi.importActual<typeof import('./jarvis-ambient-session')>('./jarvis-ambient-session')
  return {
    ...actual,
    ensureJarvisAmbientSession: vi.fn(async () => 'ambient-session-1'),
  }
})

describe('jarvis ambient observations', () => {
  it('formats metadata-only observation text without cradle_context', () => {
    const text = formatObservationText({
      kind: 'ui.segment.ended',
      occurredAt: 1,
      entity: 'chat:abc',
      entityType: 'chat',
      durationMs: 45_000,
      endReason: 'idle',
    })
    expect(text).toBe(
      '[activity] segment ended: entity=chat:abc type=chat durationMs=45000 endReason=idle',
    )
    expect(text).not.toContain('<cradle_context>')
  })

  it('appends long segments and skips short ones', async () => {
    clearRecentAmbientObservationTextsForTests()
    let now = 0
    uiActivityBus.start({
      idleTimeoutMs: 60_000,
      now: () => now,
    })
    const posts: string[] = []
    const disposable = installJarvisActivityBridge({
      minDurationMs: 30_000,
      getPrefs: () => ({
        runtimeKind: 'jar-core',
        profileId: 'profile-1',
      }),
      postObservation: async (_sessionId, _activity, text) => {
        posts.push(text)
      },
    })

    now = 0
    uiActivityBus.setResolvedEntity({ entity: 'chat:a', entityType: 'chat' })
    now = 10_000
    uiActivityBus.setResolvedEntity({ entity: 'chat:b', entityType: 'chat' })
    await vi.waitFor(() => {
      expect(posts).toEqual([])
    })

    now = 50_000
    uiActivityBus.setResolvedEntity({ entity: 'chat:c', entityType: 'chat' })
    await vi.waitFor(() => {
      expect(posts).toHaveLength(1)
    })
    expect(posts[0]).toContain('durationMs=40000')
    expect(posts[0]).not.toContain('<cradle_context>')
    expect(readRecentAmbientObservationTexts()).toEqual(posts)

    disposable.dispose()
    uiActivityBus.stop()
  })
})
