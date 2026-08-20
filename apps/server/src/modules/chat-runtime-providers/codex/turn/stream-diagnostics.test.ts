import { describe, expect, it } from 'vitest'

import { createCodexAppServerError, createCodexStreamDiagnostics } from './stream-diagnostics'

describe('codex stream error presentation', () => {
  it('keeps the protocol error core without exposing the envelope or raw event tree', () => {
    const error = createCodexAppServerError(
      {
        method: 'error',
        params: {
          threadId: 'thread-secret',
          turnId: 'turn-secret',
          willRetry: false,
          error: {
            message: 'Upstream model request failed',
            additionalDetails: 'The upstream connection was reset.',
            codexErrorInfo: {
              responseStreamDisconnected: { httpStatusCode: 502 },
            },
          },
        },
      },
      {
        ...createCodexStreamDiagnostics(),
        totalEvents: 1,
        eventTypeCounts: { error: 1 },
        errorEvents: [{ method: 'error', params: { threadId: 'thread-secret' } }],
      },
    )

    expect(error.message).toBe('Upstream model request failed')
    expect(error.data.details).toBe(
      'The upstream connection was reset.; error type: Response Stream Disconnected (HTTP 502); events: 1 total, 0 mapped; event types: error:1',
    )
    expect(error.data.details).not.toContain('thread-secret')
    expect(error.data.details).not.toContain('willRetry')
    expect(error.data.notification).toEqual({
      method: 'error',
      params: {
        threadId: 'thread-secret',
        turnId: 'turn-secret',
        willRetry: false,
        error: {
          message: 'Upstream model request failed',
          additionalDetails: 'The upstream connection was reset.',
          codexErrorInfo: {
            responseStreamDisconnected: { httpStatusCode: 502 },
          },
        },
      },
    })
  })
})
