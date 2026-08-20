import type { IpcObservedEvent } from '@cradle/ipc'
import { describe, expect, it, vi } from 'vitest'

import { IpcDevtoolStore } from './ipc-devtool-store'

function createWebContents() {
  let destroyedListener: (() => void) | undefined
  return {
    contents: {
      isDestroyed: () => false,
      once: (_event: string, listener: () => void) => { destroyedListener = listener },
      send: vi.fn(),
    },
    destroy: () => destroyedListener?.(),
  }
}

describe('ipcDevtoolStore', () => {
  it('activates observation only while at least one IPC subscriber exists', () => {
    const subscriberCounts: number[] = []
    const store = new IpcDevtoolStore({
      onIpcSubscriberCountChanged: count => subscriberCounts.push(count),
    })
    const first = createWebContents()
    const second = createWebContents()

    const unsubscribeFirst = store.subscribe(first.contents as never)
    const unsubscribeSecond = store.subscribe(second.contents as never)
    unsubscribeFirst()
    second.destroy()
    unsubscribeSecond()

    expect(subscriberCounts).toEqual([1, 2, 1, 0])
  })

  it('drops destroyed subscribers encountered while recording', () => {
    const subscriberCounts: number[] = []
    const subscriber = createWebContents()
    subscriber.contents.isDestroyed = () => true
    const store = new IpcDevtoolStore({
      onIpcSubscriberCountChanged: count => subscriberCounts.push(count),
    })

    store.subscribe(subscriber.contents as never)
    store.record({} as IpcObservedEvent)

    expect(subscriberCounts).toEqual([1, 0])
    expect(subscriber.contents.send).not.toHaveBeenCalled()
  })
})
