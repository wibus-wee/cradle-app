import { afterEach, describe, expect, it, vi } from 'vitest'

import { matchesShortcut } from './shortcut-utils'

afterEach(() => vi.restoreAllMocks())

describe('matchesShortcut', () => {
  it('maps mod to Command on macOS', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const event = {
      key: 't',
      code: 'KeyT',
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { mod: true, key: 't' })).toBe(true)
  })

  it('maps mod to Control outside macOS', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32')
    const event = {
      key: 't',
      code: 'KeyT',
      metaKey: false,
      altKey: false,
      ctrlKey: true,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { mod: true, key: 't' })).toBe(true)
  })

  it('matches an Option-modified letter by its physical key code', () => {
    const event = {
      key: '∫',
      code: 'KeyB',
      metaKey: true,
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { meta: true, alt: true, key: 'b' })).toBe(true)
  })

  it('does not match a different physical letter key', () => {
    const event = {
      key: '∫',
      code: 'KeyC',
      metaKey: true,
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { meta: true, alt: true, key: 'b' })).toBe(false)
  })

  it('matches Ctrl+` via Backquote code when event.key is unstable', () => {
    const event = {
      key: 'Dead',
      code: 'Backquote',
      metaKey: false,
      altKey: false,
      ctrlKey: true,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { ctrl: true, key: '`' })).toBe(true)
  })

  it('matches Ctrl+` when event.key is the backtick character', () => {
    const event = {
      key: '`',
      code: 'Backquote',
      metaKey: false,
      altKey: false,
      ctrlKey: true,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { ctrl: true, key: '`' })).toBe(true)
  })

  it('does not match Ctrl+` without the control modifier', () => {
    const event = {
      key: '`',
      code: 'Backquote',
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent

    expect(matchesShortcut(event, { ctrl: true, key: '`' })).toBe(false)
  })
})
