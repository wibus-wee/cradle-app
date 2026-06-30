import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { projectCradleTranscriptToCodexItems } from './transcript-projector'

describe('projectCradleTranscriptToCodexItems', () => {
  it('round-trips stored Codex response items from message metadata', () => {
    const responseItem = {
      type: 'agent_message',
      author: 'assistant',
      recipient: 'user',
      content: [{ type: 'input_text', text: 'Native Codex response' }],
      metadata: { turn_id: 'turn-1' },
    }
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Projected text', state: 'done' }],
      metadata: {
        codex: {
          responseItems: [{
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: responseItem,
          }],
        },
      },
    } satisfies UIMessage

    expect(projectCradleTranscriptToCodexItems([message])).toEqual([responseItem])
  })
})
