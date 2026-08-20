import AsyncStorage from '@react-native-async-storage/async-storage'
import type { InfiniteData } from '@tanstack/react-query'

import type { GetChatSessionsBySessionIdMessagePreviewsResponse } from '@/api-gen'

type ChatHistoryPage = GetChatSessionsBySessionIdMessagePreviewsResponse
export type ChatHistoryCacheData = InfiniteData<ChatHistoryPage, string | null>

const CACHE_VERSION = 2
const CACHE_PREFIX = '@cradle/mobile/chat-history'

function cacheKey(connectionUrl: string, sessionId: string): string {
  return `${CACHE_PREFIX}/${connectionUrl}/${sessionId}`
}

export async function readChatHistoryCache(
  connectionUrl: string,
  sessionId: string,
): Promise<ChatHistoryCacheData | null> {
  const raw = await AsyncStorage.getItem(cacheKey(connectionUrl, sessionId))
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as {
      version?: number
      data?: ChatHistoryCacheData
    }
    const page = parsed.data?.pages[0]
    if (
      parsed.version !== CACHE_VERSION
      || !page
      || !Array.isArray(parsed.data?.pages)
    ) {
      return null
    }
    return {
      pageParams: [null],
      pages: [page],
    }
  }
  catch {
    return null
  }
}

export async function writeChatHistoryCache(
  connectionUrl: string,
  sessionId: string,
  data: ChatHistoryCacheData,
): Promise<void> {
  const latestPage = data.pages[0]
  if (!latestPage) {
    return
  }
  await AsyncStorage.setItem(cacheKey(connectionUrl, sessionId), JSON.stringify({
    data: {
      pageParams: [null],
      pages: [latestPage],
    },
    version: CACHE_VERSION,
  }))
}
