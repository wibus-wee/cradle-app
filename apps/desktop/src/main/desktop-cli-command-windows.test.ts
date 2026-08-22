/* Verifies user PATH entry merging helpers used by the Windows CLI shim. */
import { describe, expect, it, vi } from 'vitest'

import {
  appendUserPathEntry,
  buildShimContent,
  removeUserPathEntry,
  splitUserPathEntries,
  userPathHasEntry,
} from './desktop-cli-command-windows'

vi.mock('electron', () => ({
  app: { isPackaged: true },
}))

describe('splitUserPathEntries', () => {
  it('returns no entries for null or empty values', () => {
    expect(splitUserPathEntries(null)).toEqual([])
    expect(splitUserPathEntries('')).toEqual([])
    expect(splitUserPathEntries(';;;')).toEqual([])
  })

  it('splits semicolon-separated entries', () => {
    expect(splitUserPathEntries('C:\\a;C:\\b')).toEqual(['C:\\a', 'C:\\b'])
  })
})

describe('userPathHasEntry', () => {
  it('matches case-insensitively and ignores trailing separators', () => {
    expect(userPathHasEntry('C:\\Other;c:\\cradle\\bin\\', 'C:/CRADLE/bin')).toBe(true)
  })

  it('does not match unrelated entries', () => {
    expect(userPathHasEntry('C:\\Other', 'C:\\cradle\\bin')).toBe(false)
  })
})

describe('appendUserPathEntry', () => {
  it('appends missing entries', () => {
    expect(appendUserPathEntry('C:\\Other', 'C:\\cradle\\bin')).toBe('C:\\Other;C:\\cradle\\bin')
    expect(appendUserPathEntry(null, 'C:\\cradle\\bin')).toBe('C:\\cradle\\bin')
  })

  it('keeps existing entries unchanged', () => {
    expect(appendUserPathEntry('C:\\a;C:\\CRADLE\\BIN\\', 'c:\\cradle\\bin')).toBe('C:\\a;C:\\CRADLE\\BIN\\')
  })
})

describe('removeUserPathEntry', () => {
  it('removes matching entries regardless of formatting', () => {
    expect(removeUserPathEntry('C:\\a;c:\\cradle\\bin\\;C:\\b', 'C:\\CRADLE\\BIN')).toBe('C:\\a;C:\\b')
  })

  it('leaves other entries untouched when absent', () => {
    expect(removeUserPathEntry('C:\\a', 'C:\\cradle\\bin')).toBe('C:\\a')
  })
})

describe('buildShimContent', () => {
  it('delegates to the bundled launcher with forwarded arguments', () => {
    expect(buildShimContent('C:\\Programs\\Cradle\\resources\\bin\\cradle.cmd')).toBe(
      '@echo off\r\n"C:\\Programs\\Cradle\\resources\\bin\\cradle.cmd" %*',
    )
  })
})
