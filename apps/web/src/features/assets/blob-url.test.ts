import { describe, expect, it, vi } from 'vitest'

import {
  resolveBlobContentUrl,
  toBlobContentUrl,
} from './blob-url'

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:21423',
}))

describe('blob content URLs', () => {
  it('builds the api-gen session route for chat-owned blobs', () => {
    expect(toBlobContentUrl('blob/1', 'session/1')).toBe(
      'http://127.0.0.1:21423/chat/sessions/session%2F1/blobs/blob%2F1/content',
    )
  })

  it('resolves blob URLs only through the session-owned route', () => {
    expect(resolveBlobContentUrl('cradle-blob://blob%2F1', 'session/1')).toBe(
      'http://127.0.0.1:21423/chat/sessions/session%2F1/blobs/blob%2F1/content',
    )
  })

  it('leaves non-blob URLs unchanged', () => {
    expect(resolveBlobContentUrl('https://example.com/image.png', 'session-1')).toBe(
      'https://example.com/image.png',
    )
  })
})
