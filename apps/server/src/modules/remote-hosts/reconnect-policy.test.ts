import { describe, expect, it } from 'vitest'

import { remoteHostReconnectDelayMs } from './reconnect-policy'

describe('remote host reconnect policy', () => {
  it('backs off exponentially and caps the base delay at thirty seconds', () => {
    const noJitter = () => 0.5

    expect(remoteHostReconnectDelayMs(0, noJitter)).toBe(1_000)
    expect(remoteHostReconnectDelayMs(1, noJitter)).toBe(2_000)
    expect(remoteHostReconnectDelayMs(4, noJitter)).toBe(16_000)
    expect(remoteHostReconnectDelayMs(5, noJitter)).toBe(30_000)
    expect(remoteHostReconnectDelayMs(20, noJitter)).toBe(30_000)
  })

  it('applies bounded symmetric jitter', () => {
    expect(remoteHostReconnectDelayMs(0, () => 0)).toBe(800)
    expect(remoteHostReconnectDelayMs(0, () => 1)).toBe(1_200)
  })
})
