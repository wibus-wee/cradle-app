import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { groupMessageParts } from './chat-render-plan'

describe('groupMessageParts', () => {
  it('keeps runtime warnings between streamed text segments', () => {
    const parts = [
      { type: 'text', text: 'Before', state: 'done' },
      {
        type: 'data-runtime-warning',
        data: {
          message: 'Reconnecting... 2/5',
          additionalDetails: 'request timed out',
        },
      },
      { type: 'text', text: 'After', state: 'done' },
    ] as UIMessage['parts']

    const items = groupMessageParts({
      parts,
      messageId: 'message-1',
      describeToolKind: () => null,
    })

    expect(items.map(item => item.kind)).toEqual(['text', 'runtime-warning', 'text'])
  })
})
