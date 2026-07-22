import { describe, expect, it } from 'vitest'

import {
  resolveElectronUpdaterFeedUrl,
  resolveSparkleAppcastUrl,
} from './update-feed'

describe('update feed helpers', () => {
  it('derives Sparkle appcast URLs from feed roots', () => {
    expect(resolveSparkleAppcastUrl('https://example.com/feed/')).toBe('https://example.com/feed/appcast.xml')
    expect(resolveSparkleAppcastUrl('https://example.com/feed/appcast.xml')).toBe('https://example.com/feed/appcast.xml')
  })

  it('derives electron-updater feed roots from appcast URLs', () => {
    expect(resolveElectronUpdaterFeedUrl('https://example.com/feed/appcast.xml')).toBe('https://example.com/feed/')
    expect(resolveElectronUpdaterFeedUrl('https://example.com/feed')).toBe('https://example.com/feed/')
  })
})
