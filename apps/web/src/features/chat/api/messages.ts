import { infiniteQueryOptions } from '@tanstack/react-query'

import {
  getChatSessionsBySessionIdMessagesInfiniteQueryKey,
  getChatSessionsBySessionIdMessagesOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { getChatSessionsBySessionIdMessages } from '~/api-gen/sdk.gen'

const CHAT_MESSAGE_HISTORY_PAGE_SIZE = 100

export function chatMessageSnapshotQueryKey(sessionId: string) {
  return getChatSessionsBySessionIdMessagesInfiniteQueryKey({
    path: { sessionId },
    query: { limit: CHAT_MESSAGE_HISTORY_PAGE_SIZE },
  })
}

export function chatMessageSnapshotQueryOptions(sessionId: string) {
  return getChatSessionsBySessionIdMessagesOptions({
    path: { sessionId },
    query: { limit: CHAT_MESSAGE_HISTORY_PAGE_SIZE },
  })
}

export function chatMessageHistoryInfiniteOptions(sessionId: string) {
  return infiniteQueryOptions({
    queryKey: chatMessageSnapshotQueryKey(sessionId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await getChatSessionsBySessionIdMessages({
        path: { sessionId },
        query: {
          limit: CHAT_MESSAGE_HISTORY_PAGE_SIZE,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
        throwOnError: true,
      })
      return data
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
  })
}
