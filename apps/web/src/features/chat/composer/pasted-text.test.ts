import { describe, expect, it } from 'vitest'

import {
  appendPastedTextsToPrompt,
  createComposerPastedText,
  extractPastedTextsFromPrompt,
  shouldCollapsePastedText,
} from './pasted-text'

describe('pasted text composer payload', () => {
  it('collapses by line or character threshold', () => {
    expect(shouldCollapsePastedText(Array.from({ length: 25 }).fill('x').join('\n'))).toBe(true)
    expect(shouldCollapsePastedText('x'.repeat(4_000))).toBe(true)
    expect(shouldCollapsePastedText('small paste')).toBe(false)
  })

  it('round trips arbitrary pasted content through the prompt block', () => {
    const pasted = createComposerPastedText('const marker = "</pasted_text>"\nnext line', 'paste-1')
    const prompt = appendPastedTextsToPrompt('Review this', [pasted])
    expect(extractPastedTextsFromPrompt(prompt)).toMatchObject({
      text: 'Review this',
      pastedTexts: [{ text: pasted.text, lineCount: 2 }],
    })
  })
})
