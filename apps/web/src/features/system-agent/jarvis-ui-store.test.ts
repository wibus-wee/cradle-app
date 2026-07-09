// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createJarvisUiStore } from './jarvis-ui-store'

type BroadcastListener = (event: MessageEvent) => void

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()

  readonly name: string
  onmessage: BroadcastListener | null = null

  constructor(name: string) {
    this.name = name
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>()
    channels.add(this)
    FakeBroadcastChannel.channels.set(name, channels)
  }

  postMessage(message: unknown) {
    for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this) {
        continue
      }
      channel.onmessage?.({ data: message } as MessageEvent)
    }
  }

  addEventListener(type: string, listener: BroadcastListener) {
    if (type !== 'message') {
      return
    }
    this.onmessage = listener
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

describe('jarvis UI cross-window sync', () => {
  beforeEach(() => {
    window.localStorage.clear()
    FakeBroadcastChannel.channels.clear()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('syncs Jarvis footer tabs and active session across stores', () => {
    const persistKey = 'jarvis-ui-cross-window-sync'
    const firstStore = createJarvisUiStore({ persistKey })
    const secondStore = createJarvisUiStore({ persistKey })

    firstStore.getState().setIncludeContext(false)
    firstStore.getState().addSession({ id: 'session-1', title: 'First request', createdAt: 1 })
    firstStore.getState().setActiveSessionId('session-1')
    firstStore.getState().updateSessionTitle('session-1', 'Resolved title')

    expect(secondStore.getState().includeContext).toBe(false)
    expect(secondStore.getState().sessions).toEqual([
      { id: 'session-1', title: 'Resolved title', createdAt: 1 },
    ])
    expect(secondStore.getState().activeSessionId).toBe('session-1')

    secondStore.getState().closeSessionTab('session-1')

    expect(firstStore.getState().sessions).toEqual([])
    expect(firstStore.getState().activeSessionId).toBeNull()
    expect(firstStore.getState().includeContext).toBe(false)
  })

  it('keeps expanded state local to each window', () => {
    const persistKey = 'jarvis-ui-expanded-local'
    const firstStore = createJarvisUiStore({ persistKey })
    const secondStore = createJarvisUiStore({ persistKey })

    firstStore.getState().setExpanded(true)
    firstStore.getState().addSession({ id: 'session-1', title: 'First request', createdAt: 1 })

    expect(firstStore.getState().expanded).toBe(true)
    expect(secondStore.getState().expanded).toBe(false)
    expect(secondStore.getState().sessions).toHaveLength(1)
  })

  it('persists the include-context preference', () => {
    const persistKey = 'jarvis-ui-include-context'
    const firstStore = createJarvisUiStore({ persistKey, crossWindowSync: false })

    expect(firstStore.getState().includeContext).toBe(true)

    firstStore.getState().setIncludeContext(false)

    const secondStore = createJarvisUiStore({ persistKey, crossWindowSync: false })

    expect(secondStore.getState().includeContext).toBe(false)
  })
})
