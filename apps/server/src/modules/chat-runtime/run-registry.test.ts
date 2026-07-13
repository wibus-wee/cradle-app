import { describe, expect, it } from 'vitest'

import { RunRegistry } from './run-registry'

describe('run registry session maintenance', () => {
  it('rejects maintenance while a session run is active or pending', () => {
    const registry = new RunRegistry()

    registry.setActiveRunIdForSession('active-session', 'run-1')
    registry.setPendingRun('pending-session', { cancelled: false })

    expect(registry.claimSessionMaintenance('active-session', 'rollback')).toBe(false)
    expect(registry.claimSessionMaintenance('pending-session', 'rollback')).toBe(false)
    expect(registry.hasSessionMaintenance('active-session')).toBe(false)
    expect(registry.hasSessionMaintenance('pending-session')).toBe(false)
  })

  it('keeps one exclusive claim until the matching operation releases it', () => {
    const registry = new RunRegistry()

    expect(registry.claimSessionMaintenance('session-1', 'rollback')).toBe(true)
    expect(registry.claimSessionMaintenance('session-1', 'rollback')).toBe(false)
    expect(registry.getSessionMaintenance('session-1')).toBe('rollback')

    registry.releaseSessionMaintenance('session-1', 'rollback')

    expect(registry.hasSessionMaintenance('session-1')).toBe(false)
    expect(registry.claimSessionMaintenance('session-1', 'rollback')).toBe(true)
  })

  it('clears maintenance claims with the rest of the in-flight registry', () => {
    const registry = new RunRegistry()
    registry.claimSessionMaintenance('session-1', 'rollback')

    registry.clearAll()

    expect(registry.hasSessionMaintenance('session-1')).toBe(false)
  })
})
