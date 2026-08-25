import type { AssistantMessage, Part } from '@opencode-ai/sdk'
import { describe, expect, it } from 'vitest'

import { mapOpencodePromptResultToChunks } from './event-to-chunk-mapper'

describe('opencode event to chunk mapper', () => {
  it('does not complete a recovered running question before the user replies', () => {
    const result = mapOpencodePromptResultToChunks({
      info: {
        id: 'message-1',
        sessionID: 'session-1',
        role: 'assistant',
        time: { created: 1 },
        parentID: 'message-0',
        modelID: 'model-1',
        providerID: 'provider-1',
        mode: 'build',
        path: { cwd: '/tmp', root: '/tmp' },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: 'tool-calls',
      } satisfies AssistantMessage,
      parts: [{
        id: 'question-1',
        sessionID: 'session-1',
        messageID: 'message-1',
        type: 'tool',
        callID: 'call-question-1',
        tool: 'question',
        state: {
          status: 'running',
          input: {
            questions: [{
              header: 'Next step',
              question: 'How should I continue?',
              options: [{ label: 'Continue', description: 'Keep working' }],
            }],
          },
          time: { start: 2 },
        },
      } satisfies Part],
    })

    expect(result.chunks.map(chunk => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'finish',
    ])
  })

  it('projects retry parts into the inline warning chain', () => {
    const result = mapOpencodePromptResultToChunks({
      info: {
        id: 'message-1',
        sessionID: 'session-1',
        role: 'assistant',
        time: { created: 1 },
        parentID: 'message-0',
        modelID: 'model-1',
        providerID: 'provider-1',
        mode: 'build',
        path: { cwd: '/tmp', root: '/tmp' },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: 'stop',
      } satisfies AssistantMessage,
      parts: [{
        id: 'retry-1',
        sessionID: 'session-1',
        messageID: 'message-1',
        type: 'retry',
        attempt: 2,
        error: {
          name: 'APIError',
          data: { message: 'upstream timed out', isRetryable: true },
        },
        time: { created: 2 },
      } satisfies Part],
    })

    expect(result.chunks).toMatchObject([
      {
        type: 'data-runtime-warning',
        data: {
          message: 'OpenCode is retrying (attempt 2).',
          additionalDetails: 'upstream timed out',
        },
      },
      { type: 'finish', finishReason: 'stop' },
    ])
  })
})
