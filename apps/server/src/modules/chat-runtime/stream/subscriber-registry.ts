import type { UIMessageChunk } from 'ai'

/**
 * A chunk subscriber receives each published chunk plus a terminal flag.
 * Shared shape used by run streams, provider-thread streams, and side-chat streams.
 */
export type ChunkSubscriber = (chunk: UIMessageChunk, terminal: boolean) => void

/**
 * A keyed registry of chunk subscribers with the fanout + lifecycle behavior
 * shared by every live chunk stream (run streams, provider-thread streams):
 *  - subscribe returns an unsubscribe that removes the subscriber and clears
 *    the key when the set drains.
 *  - publish fans out to every subscriber, drops subscribers that throw, and
 *    clears the key on terminal publish or once the set is empty.
 *
 * Replay buffering is owned by callers (the active-run buffer for run streams,
 * ProviderThreadStreamState for provider threads); this registry only owns the
 * subscriber fanout.
 */
export interface SubscriberRegistry {
  subscribe: (key: string, subscriber: ChunkSubscriber) => () => void
  publish: (key: string, chunk: UIMessageChunk, terminal: boolean) => void
  size: (key: string) => number
  delete: (key: string) => void
}

export function createSubscriberRegistry(): SubscriberRegistry {
  const subscribers = new Map<string, Set<ChunkSubscriber>>()
  return {
    subscribe(key, subscriber) {
      const set = subscribers.get(key) ?? new Set()
      set.add(subscriber)
      subscribers.set(key, set)
      return () => {
        const current = subscribers.get(key)
        if (!current) {
          return
        }
        current.delete(subscriber)
        if (current.size === 0) {
          subscribers.delete(key)
        }
      }
    },
    publish(key, chunk, terminal) {
      const set = subscribers.get(key)
      if (!set) {
        return
      }
      const dead: ChunkSubscriber[] = []
      for (const subscriber of set) {
        try {
          subscriber(chunk, terminal)
        }
 catch {
          dead.push(subscriber)
        }
      }
      for (const subscriber of dead) {
        set.delete(subscriber)
      }
      if (terminal || set.size === 0) {
        subscribers.delete(key)
      }
    },
    size(key) {
      return subscribers.get(key)?.size ?? 0
    },
    delete(key) {
      subscribers.delete(key)
    },
  }
}
