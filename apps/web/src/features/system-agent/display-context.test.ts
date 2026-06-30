import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { projectJarvisMessageForDisplay, stripCradleContextForDisplay } from './display-context'

describe('jarvis display context redaction', () => {
  it('removes closed cradle context blocks from display text', () => {
    const text = [
      '<cradle_context>',
      'viewing: Settings (settings)',
      'layout: aside open',
      '</cradle_context>',
      '',
      'Update the profile.',
    ].join('\n')

    expect(stripCradleContextForDisplay(text)).toBe('Update the profile.')
  })

  it('removes open cradle context blocks while text is streaming', () => {
    const text = [
      'Working on it.',
      '<cradle_context>',
      'viewing: Workspace (workspace)',
    ].join('\n')

    expect(stripCradleContextForDisplay(text)).toBe('Working on it.')
  })

  it('projects only text parts and keeps unchanged messages referentially stable', () => {
    const cleanMessage: UIMessage = {
      id: 'message-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello Jarvis' }],
    }
    const dirtyMessage: UIMessage = {
      id: 'message-2',
      role: 'user',
      parts: [
        { type: 'text', text: '<cradle_context>\nchat: session=abc\n</cradle_context>\n\nHello Jarvis' },
      ],
    }

    expect(projectJarvisMessageForDisplay(cleanMessage)).toBe(cleanMessage)
    expect(projectJarvisMessageForDisplay(dirtyMessage)).toEqual({
      id: 'message-2',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello Jarvis' }],
    })
  })
})
