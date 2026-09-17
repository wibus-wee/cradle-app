import type { QueryClient } from '@tanstack/react-query'

import {
  getSessionsByIdWorkOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { sessionDetailOptions } from '~/features/session/api/session-projection'

import { chatMessageHistoryInfiniteOptions } from '../api/messages'

export function prefetchChatSession(queryClient: QueryClient, sessionId: string): void {
  void queryClient.prefetchQuery(sessionDetailOptions(sessionId))
  void queryClient.prefetchQuery(getSessionsByIdWorkOptions({ path: { id: sessionId } }))
  void queryClient.prefetchInfiniteQuery(chatMessageHistoryInfiniteOptions(sessionId))
}
