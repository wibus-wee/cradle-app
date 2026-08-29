import type { QueryClient } from '@tanstack/react-query'
import { dehydrate, hashKey } from '@tanstack/react-query'

import {
  getSessionsByIdOptions,
  getSessionsByIdWorkOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { chatMessageHistoryInfiniteOptions } from '~/features/chat/api/messages'
import { queryClient } from '~/lib/query-client'

import type { AppSurface } from './surface-identity'

function readChatSessionId(surface: AppSurface): string | null {
  if (surface.route.to !== '/chat/$sessionId') {
    return null
  }
  return surface.route.params?.sessionId ?? null
}

/** Transfer only queries required for the first chat frame, never unrelated cache data. */
export function createTearoffBootstrap(surface: AppSurface) {
  return createTearoffBootstrapFromClient(surface, queryClient)
}

interface InfiniteQuerySnapshot {
  pages: unknown[]
  pageParams: unknown[]
}

function isInfiniteQuerySnapshot(value: unknown): value is InfiniteQuerySnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<InfiniteQuerySnapshot>
  return Array.isArray(candidate.pages) && Array.isArray(candidate.pageParams)
}

export function createTearoffBootstrapFromClient(surface: AppSurface, client: QueryClient) {
  const sessionId = readChatSessionId(surface)
  if (!sessionId) {
    return null
  }
  const messageHistoryQueryHash = hashKey(chatMessageHistoryInfiniteOptions(sessionId).queryKey)
  const allowedQueryHashes = new Set([
    hashKey(getSessionsByIdOptions({ path: { id: sessionId } }).queryKey),
    hashKey(getSessionsByIdWorkOptions({ path: { id: sessionId } }).queryKey),
    messageHistoryQueryHash,
  ])
  const dehydrated = dehydrate(client, {
    shouldDehydrateQuery: query =>
      query.state.status === 'success' && allowedQueryHashes.has(query.queryHash),
  })

  return {
    ...dehydrated,
    queries: dehydrated.queries.map((query) => {
      if (query.queryHash !== messageHistoryQueryHash || !isInfiniteQuerySnapshot(query.state.data)) {
        return query
      }
      return {
        ...query,
        state: {
          ...query.state,
          data: {
            ...query.state.data,
            pages: query.state.data.pages.slice(0, 1),
            pageParams: query.state.data.pageParams.slice(0, 1),
          },
        },
      }
    }),
  }
}
