import { describe, expect, it } from 'vitest'

import { parseStableMessageCacheRecord } from './stable-message-cache'

const rows = [{
  messageId: 'message-1',
  role: 'user' as const,
  status: 'complete',
  preview: 'hello',
  previewTruncated: false,
  parentMessageId: null,
  parentToolCallId: null,
  taskId: null,
  depth: 0,
  message: {
    id: 'message-1',
    role: 'user' as const,
    parts: [{ type: 'text', text: 'hello' }],
  },
}]

describe('stable message cache records', () => {
  it('accepts revisioned present and authoritative-empty snapshots', () => {
    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      schemaVersion: 6,
      revision: 4,
      snapshotState: 'present',
      cachedAt: 100,
      rows,
      nextCursor: 'older-page',
    })).toMatchObject({ revision: 4, snapshotState: 'present', rows })

    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      schemaVersion: 6,
      revision: 5,
      snapshotState: 'empty',
      cachedAt: 101,
      rows: [],
      nextCursor: null,
    })).toMatchObject({ revision: 5, snapshotState: 'empty', rows: [] })
  })

  it('rejects legacy, malformed, and invalid-revision records', () => {
    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      cachedAt: 100,
      rows,
    })).toBeNull()
    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      schemaVersion: 6,
      revision: -1,
      snapshotState: 'present',
      cachedAt: 100,
      rows,
      nextCursor: null,
    })).toBeNull()
    // v5 rows may contain provider-private response items and must be rehydrated.
    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      schemaVersion: 5,
      revision: 4,
      snapshotState: 'present',
      cachedAt: 100,
      rows,
      nextCursor: null,
    })).toBeNull()
    // Legacy v4 shell rows (no full message payload) must be rejected.
    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      schemaVersion: 4,
      revision: 4,
      snapshotState: 'present',
      cachedAt: 100,
      rows: [{ ...rows[0], message: undefined }],
      nextCursor: null,
    })).toBeNull()
    expect(parseStableMessageCacheRecord({
      sessionId: 'session-1',
      schemaVersion: 6,
      revision: 4,
      snapshotState: 'present',
      cachedAt: 100,
      rows: [{ messageId: 'broken' }],
      nextCursor: null,
    })).toBeNull()
  })
})
