import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { appendPastedTextsToPrompt, createComposerPastedText } from '../pasted-text/pasted-text'
import {
  readMessageDisplayText,
  readMessageFrame,
  readUserDisplayText,
  readUserTextDisplay,
} from './message-bubble-selectors'

function userMessage(text: string): UIMessage {
  return { id: 'user-1', role: 'user', parts: [{ type: 'text', text }] }
}

describe('pasted-text message display projection', () => {
  it('separates visible prompt text, structured cards, and safe copy text', () => {
    const serialized = appendPastedTextsToPrompt('Review this', [
      createComposerPastedText('alpha\nbeta', 'paste-1'),
    ])

    expect(readUserTextDisplay(serialized)).toMatchObject({
      displayText: 'Review this',
      pastedTexts: [{ text: 'alpha\nbeta' }],
      plainText: 'Review this\n\nalpha\nbeta',
    })
    expect(readUserDisplayText(serialized)).toBe('Review this')
    expect(readMessageDisplayText(userMessage(serialized))).toBe('Review this\n\nalpha\nbeta')
    expect(readMessageDisplayText(userMessage(serialized))).not.toContain('<pasted_text>')
  })

  it('preserves goal display behavior before adding pasted bodies', () => {
    const serialized = appendPastedTextsToPrompt('/goal Finish the review', [
      createComposerPastedText('supporting context', 'paste-1'),
    ])

    expect(readUserDisplayText(serialized)).toBe('Finish the review')
    expect(readMessageDisplayText(userMessage(serialized))).toBe(
      'Finish the review\n\nsupporting context',
    )
  })
})

describe('assistant run metadata projection', () => {
  it('restores the durable run identity and timing projection', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done' }],
      metadata: {
        cradle: {
          run: {
            runId: 'run-1',
            durationMs: 42_000,
            timings: {
              acceptMs: 100,
              ttfbMs: 300,
              ttftMs: 500,
              workedMs: 40_000,
              totalMs: 42_000,
            },
          },
        },
      },
    }

    expect(readMessageFrame(message)).toMatchObject({
      runId: 'run-1',
      runTimings: {
        acceptMs: 100,
        ttfbMs: 300,
        ttftMs: 500,
        workedMs: 40_000,
        totalMs: 42_000,
      },
    })
  })

  it('keeps legacy total time out of the Worked projection', () => {
    const message: UIMessage = {
      id: 'assistant-legacy',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done' }],
      metadata: {
        cradle: {
          run: { runId: 'run-legacy', durationMs: 42_000 },
        },
      },
    }

    expect(readMessageFrame(message).runTimings).toEqual({
      acceptMs: null,
      ttfbMs: null,
      ttftMs: null,
      workedMs: null,
      totalMs: 42_000,
    })
  })
})
