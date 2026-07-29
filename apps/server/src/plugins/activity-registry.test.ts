import type { PluginActivity, PluginManifest } from '@cradle/plugin-sdk/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { publishChatRunActivities } from '../modules/chat-runtime/es/activity-tail'
import type { StoredChatSessionEvent } from '../modules/chat-runtime/es/events'
import { registerPluginActivitySubscription } from './activity-registry'
import {
  classifyPluginSource,
  createPluginDescriptor,
  listPluginDescriptors,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
} from './runtime-registry'

function manifest(name: string): PluginManifest {
  return {
    name,
    version: '1.0.0',
    packageDir: `/plugins/${name}`,
    cradle: {
      apiVersion: '1',
      server: 'src/server.ts',
      contributes: {
        capabilities: [{
          id: 'chat-runs',
          type: 'activity-subscription',
          layer: 'server',
          label: 'Observe chat run activity',
          permissions: ['activity.read'],
        }],
        permissions: [{
          id: 'activity.read',
          label: 'Read Cradle activity',
          required: true,
        }],
      },
    },
  }
}

function registerOwner(name: string): void {
  const pluginManifest = manifest(name)
  registerPluginDescriptor(createPluginDescriptor(
    pluginManifest,
    classifyPluginSource(pluginManifest.packageDir, '/plugins'),
  ))
}

function runEvent(type: 'RunStarted' | 'RunCompleted', sequenceId: number): StoredChatSessionEvent {
  const common = {
    sequenceId,
    aggregateId: 'session-1',
    aggregateType: 'ChatSession',
    subjectRunId: 'run-1',
    version: sequenceId,
    occurredAt: 100 + sequenceId,
  }
  if (type === 'RunStarted') {
    return {
      ...common,
      type,
      payload: {
        run: {
          id: 'run-1',
          bindingId: null,
          chatSessionId: 'session-1',
          messageId: 'assistant-1',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 101,
          finishedAt: null,
        },
        assistantMessage: null,
        queueItemId: null,
      },
    }
  }
  return {
    ...common,
    type,
    payload: {
      runId: 'run-1',
      sessionId: 'session-1',
      queueItemId: null,
      bindingId: null,
      status: 'complete',
      stopReason: 'response.completed',
      errorText: null,
      finishedAt: 100 + sequenceId,
    },
  }
}

afterEach(() => {
  resetPluginRuntimeRegistry()
})

describe('plugin activity registry', () => {
  it('invokes in publication order without queuing behind async handlers', async () => {
    registerOwner('@cradle/activity-order')
    let releaseFirst: () => void = () => {}
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const calls: string[] = []
    const disposable = registerPluginActivitySubscription('@cradle/activity-order', async (activity) => {
      calls.push(`${activity.kind}:start`)
      if (activity.kind === 'chat.run.started') {
        await firstPending
        throw new Error('first delivery failed')
      }
      calls.push(`${activity.kind}:done`)
    })

    publishChatRunActivities([runEvent('RunStarted', 1), runEvent('RunCompleted', 2)])

    expect(calls).toEqual([
      'chat.run.started:start',
      'chat.run.finished:start',
      'chat.run.finished:done',
    ])
    releaseFirst()
    await vi.waitFor(() => {
      expect(calls).toEqual([
        'chat.run.started:start',
        'chat.run.finished:start',
        'chat.run.finished:done',
      ])
    })
    disposable.dispose()
  })

  it('isolates subscribers and makes disposal idempotent without cancelling in-flight work', async () => {
    registerOwner('@cradle/activity-isolation')
    let releaseInFlight: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve
    })
    const first: PluginActivity[] = []
    const second: PluginActivity[] = []
    const firstDisposable = registerPluginActivitySubscription('@cradle/activity-isolation', async (activity) => {
      first.push(activity)
      await inFlight
    })
    const secondDisposable = registerPluginActivitySubscription('@cradle/activity-isolation', (activity) => {
      second.push(activity)
    })

    publishChatRunActivities([runEvent('RunStarted', 1), runEvent('RunCompleted', 2)])
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)

    firstDisposable.dispose()
    firstDisposable.dispose()
    releaseInFlight()
    publishChatRunActivities([runEvent('RunCompleted', 3)])

    await vi.waitFor(() => {
      expect(first).toHaveLength(2)
      expect(second).toHaveLength(3)
    })
    expect(listPluginDescriptors()[0]?.capabilities).toEqual([
      expect.objectContaining({
        id: '@cradle/activity-isolation:activity-subscription.chat-runs#2',
        type: 'activity-subscription',
      }),
    ])

    secondDisposable.dispose()
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('isolates a synchronous handler failure from other subscribers', () => {
    registerOwner('@cradle/activity-sync-failure')
    const received: PluginActivity[] = []
    const failing = registerPluginActivitySubscription('@cradle/activity-sync-failure', () => {
      throw new Error('synchronous handler failure')
    })
    const healthy = registerPluginActivitySubscription('@cradle/activity-sync-failure', (activity) => {
      received.push(activity)
    })

    publishChatRunActivities([runEvent('RunStarted', 1)])

    expect(received).toHaveLength(1)
    failing.dispose()
    healthy.dispose()
  })
})
