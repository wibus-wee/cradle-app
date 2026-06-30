import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseRelayEnvelope, relayEnvelopeSchema } from './index'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'fixtures')

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
}

describe('remote relay envelope schema', () => {
  it('accepts valid host envelope fixture', () => {
    const parsed = parseRelayEnvelope(fixture('valid-host-envelope.json'))

    expect(parsed.kind).toBe('remote_agent_frame')
    expect(parsed.roomId).toBe('room_fixture')
  })

  it('accepts valid controller envelope fixture', () => {
    const parsed = parseRelayEnvelope(fixture('valid-controller-envelope.json'))

    expect(parsed.kind).toBe('remote_agent_frame')
    expect(parsed.seq).toBe(2)
  })

  it('rejects invalid version fixture', () => {
    expect(() => parseRelayEnvelope(fixture('invalid-version-envelope.json'))).toThrow()
  })

  it('rejects missing room id fixture', () => {
    const result = relayEnvelopeSchema.safeParse(fixture('missing-room-envelope.json'))

    expect(result.success).toBe(false)
  })
})
