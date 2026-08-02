import { describe, expect, it, vi } from 'vitest'

import { dispatchUiActivityToHandlers, UiActivityEngine } from './activity-engine'
import type { UiActivityEvent } from './types'

describe('uiActivityEngine', () => {
  it('ends the current segment and starts a new one on entity switch', () => {
    const events: UiActivityEvent[] = []
    let now = 1_000
    const engine = new UiActivityEngine({
      idleTimeoutMs: 60_000,
      now: () => now,
      isVisible: () => true,
      onDispatch: event => events.push(event),
    })

    engine.setResolvedEntity({ entity: 'chat:a', entityType: 'chat' })
    now = 2_000
    engine.setResolvedEntity({ entity: 'chat:b', entityType: 'chat' })

    expect(events).toEqual([
      {
        kind: 'ui.segment.started',
        occurredAt: 1_000,
        entity: 'chat:a',
        entityType: 'chat',
        previousEntity: null,
        previousEntityType: null,
      },
      {
        kind: 'ui.segment.ended',
        occurredAt: 2_000,
        entity: 'chat:a',
        entityType: 'chat',
        durationMs: 1_000,
        endReason: 'entity-changed',
      },
      {
        kind: 'ui.segment.started',
        occurredAt: 2_000,
        entity: 'chat:b',
        entityType: 'chat',
        previousEntity: 'chat:a',
        previousEntityType: 'chat',
      },
    ])
    expect(engine.getCurrentSegment()?.entity).toBe('chat:b')
    engine.dispose()
  })

  it('ends on idle and immediately resumes a new segment while visible', () => {
    vi.useFakeTimers()
    const events: UiActivityEvent[] = []
    let now = 0
    const engine = new UiActivityEngine({
      idleTimeoutMs: 5_000,
      now: () => now,
      isVisible: () => true,
      onDispatch: event => events.push(event),
    })

    engine.setResolvedEntity({ entity: 'file:src/a.ts', entityType: 'file' })
    now = 5_000
    vi.advanceTimersByTime(5_000)

    expect(events.map(e => e.kind)).toEqual([
      'ui.segment.started',
      'ui.segment.ended',
      'ui.segment.started',
    ])
    expect(events[1]).toMatchObject({
      kind: 'ui.segment.ended',
      endReason: 'idle',
      entity: 'file:src/a.ts',
      durationMs: 5_000,
    })
    expect(engine.getCurrentSegment()).toEqual({
      entity: 'file:src/a.ts',
      entityType: 'file',
      startedAt: 5_000,
    })
    engine.dispose()
    vi.useRealTimers()
  })

  it('ends on hidden and leaves getCurrentSegment null until visible resume', () => {
    const events: UiActivityEvent[] = []
    let now = 10
    let visible = true
    const engine = new UiActivityEngine({
      idleTimeoutMs: 60_000,
      now: () => now,
      isVisible: () => visible,
      onDispatch: event => events.push(event),
    })

    engine.setResolvedEntity({ entity: 'app:home', entityType: 'app' })
    now = 50
    visible = false
    engine.setVisibility(false)

    expect(events.at(-1)).toMatchObject({
      kind: 'ui.segment.ended',
      endReason: 'hidden',
      durationMs: 40,
    })
    expect(engine.getCurrentSegment()).toBeNull()

    visible = true
    now = 80
    engine.setVisibility(true)
    engine.setResolvedEntity({ entity: 'app:home', entityType: 'app' })
    expect(engine.getCurrentSegment()?.startedAt).toBe(80)
    expect(events.at(-1)).toMatchObject({
      kind: 'ui.segment.started',
      entity: 'app:home',
      previousEntity: null,
      previousEntityType: null,
    })
    engine.dispose()
  })

  it('isolates subscriber handler failures', async () => {
    const ok = vi.fn()
    const errors: Array<{ owner: string, error: unknown }> = []
    dispatchUiActivityToHandlers(
      [
        {
          owner: 'bad-sync',
          handler: () => {
            throw new Error('sync boom')
          },
        },
        {
          owner: 'bad-async',
          handler: async () => {
            throw new Error('async boom')
          },
        },
        { owner: 'ok', handler: ok },
      ],
      {
        kind: 'ui.segment.started',
        occurredAt: 1,
        entity: 'app:home',
        entityType: 'app',
        previousEntity: null,
        previousEntityType: null,
      },
      (owner, error) => errors.push({ owner, error }),
    )

    await vi.waitFor(() => {
      expect(errors).toHaveLength(2)
    })
    expect(ok).toHaveBeenCalledOnce()
    expect(errors.map(e => e.owner).sort()).toEqual(['bad-async', 'bad-sync'])
  })
})
