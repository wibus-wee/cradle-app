import { describe, expect, it } from 'vitest'

import { safeJsonParse } from './utils'

describe('safeJsonParse', () => {
  it('parses strict JSON without repair', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
  })

  it('repairs common LLM JSON mistakes via jsonrepair', () => {
    expect(safeJsonParse('{"a":1,}')).toEqual({ a: 1 })
    expect(safeJsonParse('{\'a\':1}')).toEqual({ a: 1 })
    expect(safeJsonParse('{"a":"hello\nworld"}')).toEqual({ a: 'hello\nworld' })
  })

  it('returns null for empty or nullish input', () => {
    expect(safeJsonParse(null)).toBeNull()
    expect(safeJsonParse(undefined)).toBeNull()
    expect(safeJsonParse('')).toBeNull()
  })

  it('returns null when repair still cannot produce parseable JSON', () => {
    // Bare words can be "repaired" into JSON strings by jsonrepair; use input that
    // remains invalid even after repair.
    expect(safeJsonParse('true-ish')).toBeNull()
  })
})
