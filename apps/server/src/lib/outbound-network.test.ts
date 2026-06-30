import { describe, expect, it } from 'vitest'

import {
  normalizeProxyUrl,
  parseMacScutilProxy,
  parseWindowsProxySettings,
  selectWindowsProxyUrl,
  shouldBypassProxy,
} from './outbound-network'

describe('outbound-network proxy parsing', () => {
  it('parses macOS HTTP, HTTPS, SOCKS, and bypass settings from scutil output', () => {
    const parsed = parseMacScutilProxy(`
<dictionary> {
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7890
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : 7890
  SOCKSEnable : 1
  SOCKSProxy : 127.0.0.1
  SOCKSPort : 7891
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  ExcludeSimpleHostnames : 1
}
`)

    expect(parsed.httpProxyUrl).toBe('http://127.0.0.1:7890/')
    expect(parsed.httpsProxyUrl).toBe('http://127.0.0.1:7890/')
    expect(parsed.socksProxyUrl).toBe('socks5://127.0.0.1:7891')
    expect(parsed.exceptions).toEqual(['*.local', '169.254/16'])
    expect(parsed.excludeSimpleHostnames).toBe(true)
  })

  it('parses Windows WinINET proxy settings and selects per-protocol proxies', () => {
    const parsed = parseWindowsProxySettings(JSON.stringify({
      ProxyEnable: 1,
      ProxyServer: 'http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891',
      ProxyOverride: 'localhost;*.local;<local>',
      AutoConfigURL: '',
    }))

    expect(parsed.proxyEnable).toBe(true)
    expect(selectWindowsProxyUrl(parsed.proxyServer, 'https:')).toBe('http://127.0.0.1:7890/')
    expect(selectWindowsProxyUrl('socks=127.0.0.1:7891', 'https:')).toBe('socks5://127.0.0.1:7891')
  })

  it('normalizes proxy URLs and applies bypass rules', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890/')
    expect(normalizeProxyUrl('ftp://127.0.0.1:21')).toBeNull()
    expect(shouldBypassProxy('service.local', ['*.local'], false)).toBe(true)
    expect(shouldBypassProxy('localhost', ['<local>'], false)).toBe(true)
    expect(shouldBypassProxy('api.openai.com', ['*.local'], false)).toBe(false)
  })
})
