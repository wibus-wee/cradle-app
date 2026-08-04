import { useEffect, useState } from 'react'

import { cradleFetch } from '~/lib/server-credential'

import { readBlobIdFromUrl, toBlobContentUrl } from './blob-url'

interface BlobUrlEntry {
  cleanupTimer: ReturnType<typeof setTimeout> | null
  objectUrl: string | null
  promise: Promise<string>
  references: number
}

interface BlobUrlLease {
  promise: Promise<string>
  release: () => void
}

const blobUrlEntries = new Map<string, BlobUrlEntry>()

/**
 * Fetch a protected chat blob through the authenticated client and share its
 * object URL between all consumers. The URL is revoked after the final
 * consumer releases it, with a same-turn grace period for React remounts.
 */
export function useProtectedBlobUrl(url: string, sessionId?: string | null): string | null {
  const blobId = sessionId ? readBlobIdFromUrl(url) : null
  const protectedUrl = blobId && sessionId ? toBlobContentUrl(blobId, sessionId) : null
  const [loadedUrl, setLoadedUrl] = useState<{ key: string, url: string } | null>(null)

  useEffect(() => {
    if (!protectedUrl) {
      return
    }

    let disposed = false
    const lease = acquireBlobUrl(protectedUrl)
    void lease.promise
      .then((objectUrl) => {
        if (!disposed) {
          setLoadedUrl({ key: protectedUrl, url: objectUrl })
        }
      })
      .catch(() => {
        // Keep the attachment shell visible when a protected blob is missing
        // or unavailable. The request owner can report the error separately.
      })

    return () => {
      disposed = true
      lease.release()
    }
  }, [protectedUrl])

  if (!protectedUrl) {
    return url
  }
  return loadedUrl?.key === protectedUrl ? loadedUrl.url : null
}

function acquireBlobUrl(url: string): BlobUrlLease {
  let entry = blobUrlEntries.get(url)
  if (!entry) {
    entry = createBlobUrlEntry(url)
    blobUrlEntries.set(url, entry)
  }

  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer)
    entry.cleanupTimer = null
  }
  entry.references += 1

  let released = false
  return {
    promise: entry.promise,
    release: () => {
      if (released) {
        return
      }
      released = true
      entry!.references = Math.max(0, entry!.references - 1)
      if (entry!.references === 0) {
        scheduleBlobUrlCleanup(url, entry!)
      }
    },
  }
}

function createBlobUrlEntry(url: string): BlobUrlEntry {
  const entry: BlobUrlEntry = {
    cleanupTimer: null,
    objectUrl: null,
    promise: Promise.resolve(''),
    references: 0,
  }
  entry.promise = fetchBlob(url)
    .then((blob) => {
      entry.objectUrl = URL.createObjectURL(blob)
      if (entry.references === 0) {
        scheduleBlobUrlCleanup(url, entry)
      }
      return entry.objectUrl
    })
    .catch((error: unknown) => {
      if (blobUrlEntries.get(url) === entry) {
        blobUrlEntries.delete(url)
      }
      throw error
    })
  return entry
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await cradleFetch(url)
  if (!response.ok) {
    throw new Error(`Chat blob request failed with HTTP ${response.status}`)
  }
  return await response.blob()
}

function scheduleBlobUrlCleanup(url: string, entry: BlobUrlEntry): void {
  if (entry.cleanupTimer) {
    return
  }
  entry.cleanupTimer = setTimeout(() => {
    entry.cleanupTimer = null
    if (entry.references > 0 || !entry.objectUrl) {
      return
    }
    URL.revokeObjectURL(entry.objectUrl)
    if (blobUrlEntries.get(url) === entry) {
      blobUrlEntries.delete(url)
    }
  }, 0)
}
