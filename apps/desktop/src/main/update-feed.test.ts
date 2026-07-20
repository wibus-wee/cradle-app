import { describe, expect, it } from 'vitest'

import { parseSparkleAppcast } from './macos-sparkle-update-adapter'
import {
  resolveElectronUpdaterFeedUrl,
  resolveSparkleAppcastUrl,
} from './update-feed'

describe('update feed helpers', () => {
  it('derives Sparkle appcast URLs from feed roots and legacy manifests', () => {
    expect(resolveSparkleAppcastUrl('https://example.com/feed/')).toBe('https://example.com/feed/appcast.xml')
    expect(resolveSparkleAppcastUrl('https://example.com/feed/manifest.json')).toBe('https://example.com/feed/appcast.xml')
    expect(resolveSparkleAppcastUrl('https://example.com/feed/appcast.xml')).toBe('https://example.com/feed/appcast.xml')
    expect(resolveSparkleAppcastUrl('https://example.com/feed/latest.yml')).toBe('https://example.com/feed/appcast.xml')
  })

  it('derives electron-updater feed roots from appcast or manifest URLs', () => {
    expect(resolveElectronUpdaterFeedUrl('https://example.com/feed/appcast.xml')).toBe('https://example.com/feed/')
    expect(resolveElectronUpdaterFeedUrl('https://example.com/feed/manifest.json')).toBe('https://example.com/feed/')
    expect(resolveElectronUpdaterFeedUrl('https://example.com/feed')).toBe('https://example.com/feed/')
  })
})

describe('parseSparkleAppcast', () => {
  it('parses version, notes, and enclosure metadata', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <title>Cradle 1.2.3</title>
      <pubDate>Sat, 19 Jul 2026 00:00:00 +0000</pubDate>
      <description><![CDATA[<p>Release notes</p>]]></description>
      <enclosure
        url="https://example.com/Cradle-mac-arm64.zip"
        sparkle:version="1.2.3"
        sparkle:shortVersionString="1.2.3"
        length="1234"
        type="application/octet-stream" />
    </item>
  </channel>
</rss>`

    expect(parseSparkleAppcast(xml)).toEqual([
      {
        version: '1.2.3',
        releaseName: 'Cradle 1.2.3',
        releaseNotes: '<p>Release notes</p>',
        releaseDate: 'Sat, 19 Jul 2026 00:00:00 +0000',
        files: [{
          url: 'https://example.com/Cradle-mac-arm64.zip',
          size: 1234,
          sha512: null,
        }],
      },
    ])
  })
})
