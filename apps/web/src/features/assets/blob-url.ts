import { parseBlobUrl } from '@cradle/chat-runtime-contracts'

import type { GetChatSessionsBySessionIdBlobsByBlobIdContentData } from '~/api-gen/types.gen'
import { client } from '~/lib/client.config'

const CHAT_BLOB_CONTENT_ROUTE: GetChatSessionsBySessionIdBlobsByBlobIdContentData['url']
  = '/chat/sessions/{sessionId}/blobs/{blobId}/content'

export function isCradleBlobUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && parseBlobUrl(value) !== null
}

export function readBlobIdFromUrl(value: string): string | null {
  return parseBlobUrl(value)
}

export function toBlobContentUrl(id: string, sessionId: string): string {
  return client.buildUrl({
    url: CHAT_BLOB_CONTENT_ROUTE,
    path: { sessionId, blobId: id },
  })
}

/** Resolve a `cradle-blob://` URL to its HTTP content route; leave other URLs unchanged. */
export function resolveBlobContentUrl(url: string, sessionId: string): string {
  const blobId = readBlobIdFromUrl(url)
  return blobId ? toBlobContentUrl(blobId, sessionId) : url
}
