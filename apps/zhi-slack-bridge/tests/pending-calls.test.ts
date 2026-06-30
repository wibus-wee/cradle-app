import { beforeEach, describe, expect, it } from 'vitest'

import { PendingCallManager } from '../src/pending-calls.js'

describe('pendingCallManager', () => {
  let manager: PendingCallManager

  beforeEach(() => {
    manager = new PendingCallManager()
  })

  it('resolves a pending call', async () => {
    const promise = manager.waitForResponse('call-1', 'thread-1', 5000)
    expect(manager.size).toBe(1)

    const resolved = manager.resolveCall('call-1', 'user reply')
    expect(resolved).toBe(true)
    expect(manager.size).toBe(0)

    const result = await promise
    expect(result).toBe('user reply')
  })

  it('returns false for unknown call', () => {
    const resolved = manager.resolveCall('nonexistent', 'reply')
    expect(resolved).toBe(false)
  })

  it('waits indefinitely by default', async () => {
    const promise = manager.waitForResponse('call-no-timeout', 'thread-no-timeout')

    setTimeout(() => {
      manager.resolveByThreadTs('thread-no-timeout', 'late but valid reply')
    }, 20)

    await expect(promise).resolves.toBe('late but valid reply')
  })

  it('times out pending calls', async () => {
    const promise = manager.waitForResponse('call-timeout', 'thread-timeout', 50)

    await expect(promise).rejects.toThrow(/timed out/)
    expect(manager.size).toBe(0)
  })

  it('cancels all pending calls on shutdown', async () => {
    const p1 = manager.waitForResponse('c1', 't1', 60000)
    const p2 = manager.waitForResponse('c2', 't2', 60000)
    expect(manager.size).toBe(2)

    manager.cancelAll()
    expect(manager.size).toBe(0)

    await expect(p1).rejects.toThrow(/shutting down/)
    await expect(p2).rejects.toThrow(/shutting down/)
  })

  it('resolves by thread directly', async () => {
    const promise = manager.waitForResponse('call-abc', 'thread-xyz', 5000)

    const callId = manager.resolveByThreadTs('thread-xyz', 'reply text')
    expect(callId).toBe('call-abc')

    const result = await promise
    expect(result).toBe('reply text')
  })

  it('returns null for unknown thread', () => {
    const callId = manager.resolveByThreadTs('unknown', 'reply')
    expect(callId).toBeNull()
  })
})
