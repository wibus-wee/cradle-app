import { getServerNetworkUrl, readDesktopChatEventTailBridge, readDesktopChatStreamBridge } from '~/lib/electron'

import { isSyncSocketSupported } from './client'

export type RealtimeTransport = 'ipc' | 'sync-socket' | 'sse'

export function resolveRealtimeTransport(): RealtimeTransport {
  if (readDesktopChatStreamBridge() || readDesktopChatEventTailBridge()) {
    return 'ipc'
  }
  if (isSyncSocketEnabled()) {
    return 'sync-socket'
  }
  return 'sse'
}

export function isSyncSocketEnabled(): boolean {
  if (!isSyncSocketSupported()) {
    return false
  }
  if (import.meta.env.VITE_DISABLE_SYNC_SOCKET === 'true') {
    return false
  }
  if (!URL.canParse(getServerNetworkUrl())) {
    return false
  }
  return true
}
