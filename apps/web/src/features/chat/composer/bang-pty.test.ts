import { describe, expect, it } from 'vitest'

import {
  bangPtyTranscriptHasOutput,
  composerBangPtyId,
  isComposerBangPtyDoor,
} from './bang-pty'

describe('composer bang pty helpers', () => {
  it('treats leading ! as the bang PTY door', () => {
    expect(isComposerBangPtyDoor('!')).toBe(true)
    expect(isComposerBangPtyDoor('!ls')).toBe(true)
    expect(isComposerBangPtyDoor('  !pwd')).toBe(true)
    expect(isComposerBangPtyDoor('hello')).toBe(false)
    expect(isComposerBangPtyDoor('hello!')).toBe(false)
  })

  it('builds a stable session-scoped pty id', () => {
    expect(composerBangPtyId('session-1')).toBe('terminal:composer-bang:session-1')
  })

  it('requires more than an empty prompt before discard confirm', () => {
    expect(bangPtyTranscriptHasOutput('')).toBe(false)
    expect(bangPtyTranscriptHasOutput('user@host:~/proj$')).toBe(false)
    expect(bangPtyTranscriptHasOutput('user@host:~/proj$ ls\nREADME.md\n')).toBe(true)
  })
})
