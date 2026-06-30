import { describe, expect, it } from 'vitest'

import {
  applyVisibleRangeSelection,
  mergeVisibleSelection,
  pruneSelectedIds,
  removeVisibleSelection,
  selectedIdFromSet,
  selectedRecords,
  toggleSelectedId,
  visibleRecordsAreSelected,
} from './settings-multi-selection'

describe('settings-multi-selection', () => {
  it('toggles a single selection id without mutating the original set', () => {
    const selectedIds = new Set(['a'])

    expect(toggleSelectedId(selectedIds, 'b')).toEqual(new Set(['a', 'b']))
    expect(toggleSelectedId(selectedIds, 'a')).toEqual(new Set())
    expect(selectedIds).toEqual(new Set(['a']))
  })

  it('collapses a set to a single selected id only when exactly one id is present', () => {
    expect(selectedIdFromSet(new Set())).toBeNull()
    expect(selectedIdFromSet(new Set(['a']))).toBe('a')
    expect(selectedIdFromSet(new Set(['a', 'b']))).toBeNull()
  })

  it('filters selected records and prunes ids outside the available set', () => {
    const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const selectedIds = new Set(['a', 'c'])

    expect(selectedRecords(records, selectedIds)).toEqual([{ id: 'a' }, { id: 'c' }])
    expect(pruneSelectedIds(selectedIds, new Set(['a', 'b']))).toEqual(new Set(['a']))
  })

  it('merges and removes visible selection ids symmetrically', () => {
    const records = [{ id: 'b' }, { id: 'c' }]
    const selectedIds = new Set(['a'])

    expect(mergeVisibleSelection(selectedIds, records)).toEqual(new Set(['a', 'b', 'c']))
    expect(removeVisibleSelection(new Set(['a', 'b', 'c']), records)).toEqual(new Set(['a']))
  })

  it('applies range selection between an anchor and target in visible order', () => {
    const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    expect(applyVisibleRangeSelection(new Set(['x']), records, 'b', 'd', true)).toEqual(
      new Set(['x', 'b', 'c', 'd']),
    )
    expect(applyVisibleRangeSelection(new Set(['a', 'b', 'c', 'd']), records, 'b', 'd', false))
      .toEqual(new Set(['a']))
  })

  it('falls back to a single toggle when range endpoints are not visible', () => {
    const records = [{ id: 'a' }, { id: 'b' }]

    expect(applyVisibleRangeSelection(new Set(['a']), records, 'missing', 'b', true)).toEqual(
      new Set(['a', 'b']),
    )
    expect(applyVisibleRangeSelection(new Set(['a', 'b']), records, 'a', 'missing', false))
      .toEqual(new Set(['a', 'b']))
  })

  it('checks whether all visible records are selected', () => {
    const records = [{ id: 'a' }, { id: 'b' }]

    expect(visibleRecordsAreSelected(records, new Set(['a', 'b']))).toBe(true)
    expect(visibleRecordsAreSelected(records, new Set(['a']))).toBe(false)
    expect(visibleRecordsAreSelected([], new Set(['a', 'b']))).toBe(false)
  })
})
