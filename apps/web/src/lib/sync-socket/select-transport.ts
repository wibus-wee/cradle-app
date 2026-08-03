import { getServerNetworkUrl, readDesktopChatEventTailBridge, readDesktopChatStreamBridge } from '~/lib/electron'
import { isCradleServerLocalUrl } from '~/lib/server-transport/base-url'

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
  // Refuse selecting /sync WebSocket against cradle-server:// (not a WS endpoint).
  // getServerNetworkUrl() must remain HTTP(S); if it ever is custom-scheme, fall back to SSE.
  if (isCradleServerLocalUrl(getServerNetworkUrl())) {
    return false
  }
  return true
}
