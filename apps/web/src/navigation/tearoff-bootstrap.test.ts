import type { QueryKey } from '@tanstack/react-query'
import { hashKey, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  getSessionsByIdOptions,
  getSessionsByIdWorkOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { chatMessageHistoryInfiniteOptions } from '~/features/chat/api/messages'

import type { AppSurface } from './surface-identity'
import { createTearoffBootstrapFromClient } from './tearoff-bootstrap'

const SESSION_ID = 'session-1'
const CHAT_SURFACE: AppSurface = {
  id: `chat:${SESSION_ID}`,
  kind: 'chat',
  title: 'Session 1',
  route: { to: '/chat/$sessionId', params: { sessionId: SESSION_ID } },
  order: 0,
  closable: true,
}

describe('createTearoffBootstrapFromClient', () => {
  it('copies only first-frame queries and caps message history to its newest page', () => {
    const client = new QueryClient()
    const sessionKey = getSessionsByIdOptions({ path: { id: SESSION_ID } }).queryKey
    const workKey = getSessionsByIdWorkOptions({ path: { id: SESSION_ID } }).queryKey
    const messageKey = chatMessageHistoryInfiniteOptions(SESSION_ID).queryKey
    const unrelatedKey = ['large-unrelated-cache'] as const

    client.setQueryData(sessionKey as QueryKey, { id: SESSION_ID })
    client.setQueryData(workKey as QueryKey, { work: null })
    client.setQueryData(messageKey as QueryKey, {
      pages: [
        { revision: 3, rows: [], nextCursor: 'older-cursor' },
        { revision: 2, rows: [], nextCursor: 'oldest-cursor' },
        { revision: 1, rows: [], nextCursor: null },
      ],
      pageParams: [null, 'older-cursor', 'oldest-cursor'],
    })
    client.setQueryData(unrelatedKey, Array.from({ length: 1_000 }).fill('do-not-copy'))

    const snapshot = createTearoffBootstrapFromClient(CHAT_SURFACE, client)

    expect(snapshot).not.toBeNull()
    expect(snapshot?.queries.map(query => query.queryHash).sort()).toEqual([
      hashKey(sessionKey),
      hashKey(workKey),
      hashKey(messageKey),
    ].sort())
    const messageQuery = snapshot?.queries.find(query => query.queryHash === hashKey(messageKey))
    expect(messageQuery?.state.data).toEqual({
      pages: [{ revision: 3, rows: [], nextCursor: 'older-cursor' }],
      pageParams: [null],
    })
    expect(snapshot?.queries.some(query => query.queryHash === hashKey(unrelatedKey))).toBe(false)
  })

  it('does not transfer cache data for non-chat surfaces', () => {
    const client = new QueryClient()
    client.setQueryData(['large-unrelated-cache'], Array.from({ length: 1_000 }).fill('do-not-copy'))

    expect(createTearoffBootstrapFromClient({
      ...CHAT_SURFACE,
      id: 'new-work',
      kind: 'new-work',
      route: { to: '/work/new' },
    }, client)).toBeNull()
  })
})
