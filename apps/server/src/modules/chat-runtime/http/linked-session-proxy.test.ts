import { describe, expect, it } from 'vitest'

import { matchChatSessionPath } from './linked-session-proxy'

describe('matchChatSessionPath', () => {
  it('extracts session ids from chat session paths', () => {
    expect(matchChatSessionPath('/chat/sessions/abc')).toBe('abc')
    expect(matchChatSessionPath('/chat/sessions/abc/queue')).toBe('abc')
    expect(matchChatSessionPath('/chat/sessions/abc/provider-threads/t1/stream')).toBe('abc')
  })

  it('ignores non-session chat paths', () => {
    expect(matchChatSessionPath('/chat/composer-drafts/surface-1')).toBeNull()
    expect(matchChatSessionPath('/chat/runs/completed')).toBeNull()
    expect(matchChatSessionPath('/sessions/abc')).toBeNull()
  })
})
