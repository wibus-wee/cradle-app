import { describe, expect, it } from 'vitest'

import { formatSelectionAsQuote, readMessageSelection } from './message-selection'

describe('formatSelectionAsQuote', () => {
  it('quotes every selected line and leaves room for a follow-up', () => {
    expect(formatSelectionAsQuote('first\r\nsecond')).toBe('> first\n> second\n\n')
  })

  it('returns an empty string for whitespace-only selections', () => {
    expect(formatSelectionAsQuote(' \n\t ')).toBe('')
  })
})

describe('readMessageSelection', () => {
  it('accepts a selection contained by one message', () => {
    document.body.innerHTML = '<main><article data-message-id="message-1"><div data-message-content>hello world</div></article></main>'
    const root = document.querySelector('main') as HTMLElement
    const content = root.querySelector('[data-message-content]') as HTMLElement
    const text = content.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 116, left: 24 }),
    })
    const selection = window.getSelection() as Selection
    selection.removeAllRanges()
    selection.addRange(range)

    expect(readMessageSelection(root, selection)).toMatchObject({
      messageId: 'message-1',
      selectedText: 'hello',
    })
  })

  it('rejects selections spanning two messages', () => {
    document.body.innerHTML = '<main><article data-message-id="message-1"><div data-message-content>hello</div></article><article data-message-id="message-2"><div data-message-content>world</div></article></main>'
    const root = document.querySelector('main') as HTMLElement
    const firstText = root.querySelector('[data-message-content]')?.firstChild as Text
    const secondText = root.querySelectorAll('[data-message-content]')[1]?.firstChild as Text
    const range = document.createRange()
    range.setStart(firstText, 0)
    range.setEnd(secondText, 5)
    const selection = window.getSelection() as Selection
    selection.removeAllRanges()
    selection.addRange(range)

    expect(readMessageSelection(root, selection)).toBeNull()
  })
})
