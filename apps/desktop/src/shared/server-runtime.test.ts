import { describe, expect, it } from 'vitest'

import {
  applyServerBootstrapEvent,
  createDesktopServerBootstrapSnapshot,
} from './server-runtime'

describe('desktop server bootstrap snapshot', () => {
  it('retains phase start, completion, and failure timestamps from server events', () => {
    const startedAt = '2026-07-24T00:00:00.000Z'
    const completedAt = '2026-07-24T00:00:10.000Z'
    const failedAt = '2026-07-24T00:00:20.000Z'
    let snapshot = createDesktopServerBootstrapSnapshot(new Date(startedAt))

    snapshot = applyServerBootstrapEvent(snapshot, {
      type: 'cradle-server-bootstrap',
      phase: 'database-migration',
      kind: 'started',
      at: startedAt,
    })
    snapshot = applyServerBootstrapEvent(snapshot, {
      type: 'cradle-server-bootstrap',
      phase: 'database-migration',
      kind: 'completed',
      at: completedAt,
    })
    snapshot = applyServerBootstrapEvent(snapshot, {
      type: 'cradle-server-bootstrap',
      phase: 'database-maintenance',
      kind: 'started',
      at: completedAt,
    })
    snapshot = applyServerBootstrapEvent(snapshot, {
      type: 'cradle-server-bootstrap',
      phase: 'database-maintenance',
      kind: 'failed',
      at: failedAt,
      error: 'compaction failed',
    })

    expect(snapshot.phases).toMatchObject({
      'database-migration': { startedAt, completedAt },
      'database-maintenance': { startedAt: completedAt, failedAt, error: 'compaction failed' },
    })
  })
})
