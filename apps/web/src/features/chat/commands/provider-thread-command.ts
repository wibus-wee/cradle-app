// Chat Runtime provider-thread HTTP boundary for provider-native subagent/thread detail panels.
import type { UIMessage } from 'ai'

import {
  getChatSessionsBySessionIdProviderThreadsByThreadIdQueryKey,
  getChatSessionsBySessionIdProviderThreadsByThreadIdTurnsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { client } from '~/api-gen/client.gen'
import {
  deleteChatSessionsBySessionIdProviderThreadsByThreadId,
  getChatSessionsBySessionIdProviderThreadsByThreadId,
  getChatSessionsBySessionIdProviderThreadsByThreadIdTurns,
} from '~/api-gen/sdk.gen'
import type {
  DeleteChatSessionsBySessionIdProviderThreadsByThreadIdResponse,
  GetChatSessionsBySessionIdProviderThreadsByThreadIdResponse,
  GetChatSessionsBySessionIdProviderThreadsByThreadIdStreamResponses,
  GetChatSessionsBySessionIdProviderThreadsByThreadIdTurnsResponse,
} from '~/api-gen/types.gen'

export type ProviderThreadReadResponse = GetChatSessionsBySessionIdProviderThreadsByThreadIdResponse
export type ProviderThread = ProviderThreadReadResponse['thread']
export type ProviderThreadTurnsResponse = Omit<GetChatSessionsBySessionIdProviderThreadsByThreadIdTurnsResponse, 'messages'> & {
  messages: UIMessage[]
}
export type ProviderThreadDeleteResponse = DeleteChatSessionsBySessionIdProviderThreadsByThreadIdResponse

export function providerThreadQueryKey(sessionId: string, threadId: string): readonly unknown[] {
  return getChatSessionsBySessionIdProviderThreadsByThreadIdQueryKey({
    path: { sessionId, threadId },
  })
}

export function providerThreadTurnsQueryKey(sessionId: string, threadId: string): readonly unknown[] {
  return getChatSessionsBySessionIdProviderThreadsByThreadIdTurnsQueryKey({
    path: { sessionId, threadId },
    query: { sortDirection: 'asc' },
  })
}

export async function getProviderThread(
  sessionId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProviderThreadReadResponse> {
  const { data } = await getChatSessionsBySessionIdProviderThreadsByThreadId({
    path: { sessionId, threadId },
    signal,
    throwOnError: true,
  })
  return data
}

export async function getProviderThreadTurns(
  sessionId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProviderThreadTurnsResponse> {
  const { data } = await getChatSessionsBySessionIdProviderThreadsByThreadIdTurns({
    path: { sessionId, threadId },
    query: { sortDirection: 'asc' },
    signal,
    throwOnError: true,
  })
  return data as ProviderThreadTurnsResponse
}

export async function deleteProviderThread(
  sessionId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProviderThreadDeleteResponse> {
  const { data } = await deleteChatSessionsBySessionIdProviderThreadsByThreadId({
    path: { sessionId, threadId },
    signal,
    throwOnError: true,
  })
  return data
}

export async function subscribeProviderThreadStream(args: {
  sessionId: string
  threadId: string
  signal?: AbortSignal
}): Promise<Response> {
  const { response } = await client.get<GetChatSessionsBySessionIdProviderThreadsByThreadIdStreamResponses, unknown, true>({
    parseAs: 'stream',
    path: { sessionId: args.sessionId, threadId: args.threadId },
    signal: args.signal,
    throwOnError: true,
    url: '/chat/sessions/{sessionId}/provider-threads/{threadId}/stream',
  })
  return response
}
