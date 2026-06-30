import { describe, expect, it } from 'vitest'

import { findOpenFenceLanguage, shouldBypassSmoother } from './fence-state'

describe('findOpenFenceLanguage', () => {
  it('returns null for no fences', () => {
    expect(findOpenFenceLanguage('hello world')).toBeNull()
  })
  it('returns null for closed fence', () => {
    expect(findOpenFenceLanguage('```js\ncode\n```')).toBeNull()
  })
  it('returns language for open fence', () => {
    expect(findOpenFenceLanguage('```typescript\nconst x')).toBe('typescript')
  })
  it('returns empty string for fence with no language', () => {
    expect(findOpenFenceLanguage('```\ncode')).toBe('')
  })
  it('handles tilde fences', () => {
    expect(findOpenFenceLanguage('~~~python\nprint')).toBe('python')
  })
  it('handles multiple fences, last open', () => {
    expect(findOpenFenceLanguage('```js\ncode\n```\n```html\n<div>')).toBe('html')
  })
  it('handles indented fences (up to 3 spaces)', () => {
    expect(findOpenFenceLanguage('   ```rust\nfn')).toBe('rust')
  })
  it('returns null for 4+ space indent (not a fence)', () => {
    expect(findOpenFenceLanguage('    ```rust\nfn')).toBeNull()
  })
})

describe('shouldBypassSmoother', () => {
  it('returns true for open html fence', () => {
    expect(shouldBypassSmoother('```html\n<div>')).toBe(true)
  })
  it('returns true for open svg fence', () => {
    expect(shouldBypassSmoother('```svg\n<svg>')).toBe(true)
  })
  it('returns false for open js fence', () => {
    expect(shouldBypassSmoother('```js\nconst')).toBe(false)
  })
  it('returns false for no fence', () => {
    expect(shouldBypassSmoother('hello')).toBe(false)
  })
  it('returns false for closed html fence', () => {
    expect(shouldBypassSmoother('```html\n<div>\n```')).toBe(false)
  })
})
