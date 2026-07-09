import { describe, expect, it } from 'vitest'

import { describeChatExecutionError } from './chat-execution-errors'

describe('describeChatExecutionError', () => {
  it('maps known remote execution codes', () => {
    expect(describeChatExecutionError({ code: 'chat_session_executes_on_remote_host' }))
      .toMatch(/remote host/i)
    expect(describeChatExecutionError({ code: 'remote_cradle_server_not_connected' }))
      .toMatch(/disconnected/i)
  })

  it('returns null for unrelated errors', () => {
    expect(describeChatExecutionError({ code: 'something_else' })).toBeNull()
    expect(describeChatExecutionError(new Error('boom'))).toBeNull()
  })
})
