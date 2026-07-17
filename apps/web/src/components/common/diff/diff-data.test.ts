import { describe, expect, it } from 'vitest'

import { buildDiffData, diffContentCacheKey } from './diff-data'

describe('shared diff data', () => {
  it('indexes current and previous paths for renamed files', () => {
    const data = buildDiffData([
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 75%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1 +1 @@',
      '-export const value = 1',
      '+export const value = 2',
    ].join('\n'))

    expect(data.items).toHaveLength(1)
    const itemId = data.items[0]?.id
    expect(itemId).toBeDefined()
    expect(data.pathToItemId.get('src/old.ts')).toBe(itemId)
    expect(data.pathToItemId.get('src/new.ts')).toBe(itemId)
    expect(data.itemIdToPath.get(itemId!)).toBe('src/new.ts')
  })

  it('marks whitespace-only changes once for both rename paths', () => {
    const data = buildDiffData([
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 75%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1 +1 @@',
      '-const value = 1',
      '+const   value = 1',
    ].join('\n'))

    expect(data.whitespaceOnlyPaths).toEqual(new Set(['src/new.ts', 'src/old.ts']))
  })

  it('uses the complete content when creating cache keys', () => {
    const prefix = 'same-prefix-and-suffix'.repeat(4)
    const suffix = 'same-suffix'.repeat(8)
    const first = `${prefix}first middle${suffix}`
    const second = `${prefix}other middle${suffix}`
    const firstKey = diffContentCacheKey('old', 'src/file.ts', first)
    const secondKey = diffContentCacheKey('old', 'src/file.ts', second)

    expect(firstKey).not.toBe(secondKey)
  })
})
