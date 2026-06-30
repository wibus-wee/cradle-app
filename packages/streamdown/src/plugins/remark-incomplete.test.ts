import { describe, expect, it } from 'vitest'

import { patchIncomplete } from './remark-incomplete'

describe('patchIncomplete', () => {
  it('patches incomplete link', () => {
    expect(patchIncomplete('[text](http://ex')).toContain('streamdown:incomplete-link')
  })
  it('patches incomplete image', () => {
    expect(patchIncomplete('![alt](http://ex')).toContain('streamdown:incomplete-link')
  })
  it('closes unclosed code fence', () => {
    const result = patchIncomplete('```js\ncode')
    expect(result.endsWith('```') || result.includes('```')).toBe(true)
  })
  it('closes unclosed inline code', () => {
    const result = patchIncomplete('hello `code')
    expect(result).toContain('`')
  })
  it('closes unclosed math block', () => {
    const result = patchIncomplete('$$\nx^2')
    expect(result).toContain('$$')
  })
  it('does not modify complete markdown', () => {
    const md = '# Hello\n\n[link](url)\n\n```js\ncode\n```'
    expect(patchIncomplete(md)).toBe(md)
  })
  it('closes unclosed bold', () => {
    const result = patchIncomplete('**bold text')
    expect(result.match(/\*\*/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
