import { describe, expect, it } from 'vitest'

import { projectCodexNativeTurnsToCodexItems } from './native-history-projector'

describe('projectCodexNativeTurnsToCodexItems', () => {
  it('preserves Codex turn ids as response item metadata', () => {
    expect(projectCodexNativeTurnsToCodexItems([
      {
        id: 'turn-1',
        status: 'completed',
        itemsView: 'full',
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        error: null,
        items: [
          {
            type: 'agentMessage',
            id: 'agent-message-1',
            text: 'Native answer',
            phase: null,
            memoryCitation: null,
          },
        ],
      },
    ])).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Native answer' }],
        metadata: { turn_id: 'turn-1' },
      },
    ])
  })
})
