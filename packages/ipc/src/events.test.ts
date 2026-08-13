import { describe, expect, it } from 'vitest'

import { serializePayload } from './events'

describe('serializePayload', () => {
  it('bounds traversal before serializing diagnostic payloads', () => {
    let reads = 0
    const payload: Record<string, unknown> = {}
    for (let index = 0; index < 100; index++) {
      Object.defineProperty(payload, `field${index}`, {
        enumerable: true,
        get: () => {
          reads++
          return index
        },
      })
    }

    const serialized = serializePayload(payload)

    expect(reads).toBe(50)
    expect(serialized.json).toContain('more properties')
  })

  it('handles cycles without traversing the original graph twice', () => {
    const payload: { self?: unknown } = {}
    payload.self = payload

    expect(serializePayload(payload).json).toContain('[Circular]')
  })

  it('bounds error strings before diagnostic serialization', () => {
    const error = new Error('x'.repeat(10_000))
    error.stack = 's'.repeat(10_000)

    const serialized = serializePayload(error, { maxLength: 20_000 })

    expect(serialized.json.length).toBeLessThan(5_000)
    expect(serialized.summary.length).toBe(81)
  })

  it('does not let hostile object reflection break IPC diagnostics', () => {
    const payload = new Proxy({}, {
      ownKeys: () => {
        throw new Error('reflection blocked')
      },
    })

    expect(() => serializePayload(payload)).not.toThrow()
    expect(serializePayload(payload).summary).toBe('Unserializable value')
  })
})
