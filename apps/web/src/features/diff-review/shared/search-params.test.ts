import { describe, expect, it } from 'vitest'

import { DIFF_ANCHOR_SIDES, parseAnchorSide, parsePositiveInt } from './search-params'

describe('diff search params', () => {
  it('parses positive integers from numbers and numeric strings', () => {
    expect(parsePositiveInt(12)).toBe(12)
    expect(parsePositiveInt('42')).toBe(42)
  })

  it('rejects non-positive, fractional, and non-numeric lines', () => {
    expect(parsePositiveInt(0)).toBeUndefined()
    expect(parsePositiveInt('0')).toBeUndefined()
    expect(parsePositiveInt(-3)).toBeUndefined()
    expect(parsePositiveInt(1.5)).toBeUndefined()
    expect(parsePositiveInt('abc')).toBeUndefined()
    expect(parsePositiveInt(undefined)).toBeUndefined()
    expect(parsePositiveInt(null)).toBeUndefined()
    expect(parsePositiveInt({})).toBeUndefined()
  })

  it('parses only the declared anchor sides', () => {
    for (const side of DIFF_ANCHOR_SIDES) {
      expect(parseAnchorSide(side)).toBe(side)
    }
    expect(parseAnchorSide('left')).toBeUndefined()
    expect(parseAnchorSide('')).toBeUndefined()
    expect(parseAnchorSide(1)).toBeUndefined()
    expect(parseAnchorSide(undefined)).toBeUndefined()
  })
})
