import { afterEach, describe, expect, it, vi } from 'vitest'

import { pluginDevSessions } from './dev-session-service'
import { pluginLifecycle } from './lifecycle-service'
import { openPluginEventStream } from './plugin-event-stream'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('plugin event stream', () => {
  it('wraps lifecycle events for the shared plugin subscription', async () => {
    const abortController = new AbortController()
    const reader = openPluginEventStream(abortController.signal).getReader()
    const decoder = new TextDecoder()

    const open = await reader.read()
    expect(decoder.decode(open.value)).toBe(': cradle-event-stream-open\n\n')

    const lifecycleEvent = pluginLifecycle.publish({
      type: 'activation-changed',
      sourceId: null,
      pluginIdentities: ['@cradle/example'],
      chatSessionId: null,
    })
    const message = await reader.read()

    expect(JSON.parse(decoder.decode(message.value).replace(/^data:\s*/, '').trim())).toEqual({
      scope: 'lifecycle',
      event: lifecycleEvent,
    })

    abortController.abort()
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('wraps development session events for the shared plugin subscription', async () => {
    let emitDevSession: Parameters<typeof pluginDevSessions.subscribe>[0] | undefined
    const unsubscribe = vi.fn()
    vi.spyOn(pluginDevSessions, 'subscribe').mockImplementation((listener) => {
      emitDevSession = listener
      return unsubscribe
    })
    const abortController = new AbortController()
    const reader = openPluginEventStream(abortController.signal).getReader()
    const decoder = new TextDecoder()

    await reader.read()
    emitDevSession?.({
      type: 'reloaded',
      layer: 'web',
      session: {
        id: 'dev-session',
        pluginName: '@cradle/example',
        routeSegment: 'example',
        displayName: 'Example',
        packageDir: '/tmp/example',
        entries: { server: null, web: 'dist/web.js', desktop: null },
        revisions: { server: 0, web: 2, desktop: 0 },
        createdAt: 1,
        updatedAt: 2,
      },
    })
    const message = await reader.read()

    expect(JSON.parse(decoder.decode(message.value).replace(/^data:\s*/, '').trim())).toMatchObject({
      scope: 'dev-session',
      event: {
        type: 'reloaded',
        layer: 'web',
        session: { id: 'dev-session', pluginName: '@cradle/example' },
      },
    })

    abortController.abort()
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
