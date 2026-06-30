import type { ChatSessionMessageRow } from './use-chat-session'

const DB_NAME = 'cradle-chat-stable-message-cache'
const DB_VERSION = 1
const STORE_NAME = 'stable-message-rows'
const CACHED_SESSION_LIMIT = 80

interface StableMessageCacheRecord {
  sessionId: string
  cachedAt: number
  rows: ChatSessionMessageRow[]
}

let dbPromise: Promise<IDBDatabase> | null = null

export async function readStableMessageRows(sessionId: string): Promise<ChatSessionMessageRow[] | null> {
  if (!canUseIndexedDb()) {
    return null
  }

  const db = await openStableMessageCacheDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(sessionId)
    request.onerror = () => reject(request.error ?? new Error('Failed to read stable chat message cache'))
    request.onsuccess = () => {
      const record = readCacheRecord(request.result)
      resolve(record?.rows ?? null)
    }
  })
}

export async function writeStableMessageRows(sessionId: string, rows: ChatSessionMessageRow[]): Promise<void> {
  if (!canUseIndexedDb()) {
    return
  }

  const db = await openStableMessageCacheDb()
  await writeCacheRecord(db, {
    sessionId,
    cachedAt: Date.now(),
    rows,
  })
  await pruneStableMessageCache(db)
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openStableMessageCacheDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise
  }

  const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Failed to open stable chat message cache'))
    request.onupgradeneeded = () => {
      const db = request.result
      const transaction = request.transaction
      if (!transaction) {
        reject(new Error('Stable chat message cache upgrade transaction was unavailable'))
        return
      }
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' })
      if (!store.indexNames.contains('cachedAt')) {
        store.createIndex('cachedAt', 'cachedAt')
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onblocked = () => reject(new Error('Stable chat message cache upgrade was blocked'))
  })
  const guardedPromise = openPromise.catch((error: unknown): never => {
    dbPromise = null
    throw error
  })

  dbPromise = guardedPromise
  return guardedPromise
}

function readCacheRecord(value: unknown): StableMessageCacheRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Partial<StableMessageCacheRecord>
  if (typeof record.sessionId !== 'string' || typeof record.cachedAt !== 'number') {
    return null
  }
  const rows = readMessageRows(record.rows)
  if (!rows) {
    return null
  }
  return {
    sessionId: record.sessionId,
    cachedAt: record.cachedAt,
    rows,
  }
}

function readMessageRows(value: unknown): ChatSessionMessageRow[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  for (const row of value) {
    if (!isMessageRow(row)) {
      return null
    }
  }
  return value
}

function isMessageRow(value: unknown): value is ChatSessionMessageRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const row = value as Partial<ChatSessionMessageRow>
  if (
    typeof row.messageId !== 'string'
    || (row.role !== 'user' && row.role !== 'assistant')
    || typeof row.status !== 'string'
    || typeof row.content !== 'string'
    || typeof row.depth !== 'number'
  ) {
    return false
  }
  const message = row.message as Partial<ChatSessionMessageRow['message']> | undefined
  return Boolean(
    message
    && typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && Array.isArray(message.parts),
  )
}

function writeCacheRecord(db: IDBDatabase, record: StableMessageCacheRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to write stable chat message cache'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Stable chat message cache write was aborted'))
    transaction.objectStore(STORE_NAME).put(record)
  })
}

function pruneStableMessageCache(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.index('cachedAt').getAllKeys()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to prune stable chat message cache'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Stable chat message cache prune was aborted'))
    request.onerror = () => reject(request.error ?? new Error('Failed to read stable chat message cache keys'))
    request.onsuccess = () => {
      const staleKeys = request.result.slice(0, Math.max(0, request.result.length - CACHED_SESSION_LIMIT))
      for (const key of staleKeys) {
        store.delete(key)
      }
    }
  })
}
