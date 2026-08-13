import { describe, expect, it } from 'vitest'

import { tokenizeBlocks, tokenizeBlocksIncremental } from './use-block-queue'

describe('tokenizeBlocksIncremental', () => {
  it('keeps closed block identities and retokenizes the active tail', () => {
    const content = 'First paragraph.\n\nSecond paragraph'
    const blocks = tokenizeBlocks(content)
    const nextContent = `${content} grows.\n\nThird paragraph.`
    const next = tokenizeBlocksIncremental(nextContent, { content, blocks })
    const expected = tokenizeBlocks(nextContent)

    expect(next[0]).toBe(blocks[0])
    expect(next).toEqual(expected)
    expect(next.at(-1)?.content).toContain('Third paragraph')
  })

  it('falls back to full tokenization when a stable prefix changes', () => {
    const content = 'First paragraph.\n\nSecond paragraph.'
    const blocks = tokenizeBlocks(content)
    const replacement = 'Replaced paragraph.\n\nSecond paragraph.'
    const next = tokenizeBlocksIncremental(replacement, { content, blocks })

    expect(next[0]).not.toBe(blocks[0])
    expect(next).toEqual(tokenizeBlocks(replacement))
  })
})
