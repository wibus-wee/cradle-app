import { backendSessionBindings, sessions } from '@cradle/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../infra'
import { liveRuntimeSessionRegistry } from './runtime-live-session-registry'
import type { RuntimeSession, RuntimeSettings } from './runtime-provider-types'
import { updateSessionRuntimeSettings } from './runtime-settings-api'

const runtimeKind = 'codex'

afterEach(() => {
  liveRuntimeSessionRegistry.clear()
  db().delete(backendSessionBindings).run()
  db().delete(sessions).run()
  vi.restoreAllMocks()
})

function insertSession(input: {
  sessionId: string
  configJson?: string
}): void {
  db().insert(sessions).values({
    id: input.sessionId,
    title: 'Runtime Settings Session',
    providerTargetId: null,
    runtimeKind,
    configJson: input.configJson ?? '{}',
  }).run()
}

function registerLiveRuntimeSession(input: {
  sessionId: string
  updateRuntimeSettings: (settings: RuntimeSettings) => Promise<void>
}): void {
  liveRuntimeSessionRegistry.register({
    sessionId: input.sessionId,
    runtimeKind,
    providerTargetId: null,
    readRuntimeSession: () => ({
      id: input.sessionId,
      chatSessionId: input.sessionId,
      providerTargetId: null,
      runtimeKind,
      providerSessionId: null,
      providerStateSnapshot: null,
    } satisfies RuntimeSession),
    updateRuntimeSettings: input.updateRuntimeSettings,
  })
}

describe('updateSessionRuntimeSettings', () => {
  it('applies settings to a registered idle live runtime session', async () => {
    insertSession({
      sessionId: 'idle-runtime-settings-session',
    })
    const updateRuntimeSettings = vi.fn(async (_settings: RuntimeSettings) => undefined)
    registerLiveRuntimeSession({
      sessionId: 'idle-runtime-settings-session',
      updateRuntimeSettings,
    })

    const result = await updateSessionRuntimeSettings({
      sessionId: 'idle-runtime-settings-session',
      patch: {
        accessMode: 'full-access',
        interactionMode: 'default',
      },
    })

    expect(result.applied).toBe(true)
    expect(updateRuntimeSettings).toHaveBeenCalledOnce()
    expect(updateRuntimeSettings).toHaveBeenCalledWith({
      accessMode: 'full-access',
      interactionMode: 'default',
    })
  })

  it('does not infer idle live runtime sessions from durable bindings alone', async () => {
    insertSession({
      sessionId: 'idle-runtime-settings-unregistered-session',
    })
    db().insert(backendSessionBindings).values({
      id: 'runtime-settings-binding',
      chatSessionId: 'idle-runtime-settings-unregistered-session',
      providerTargetId: null,
      runtimeKind,
      backendSessionId: 'provider-session-1',
      backendStateSnapshot: JSON.stringify({ provider: 'state' }),
      requestedModelId: 'model-1',
    }).run()

    const result = await updateSessionRuntimeSettings({
      sessionId: 'idle-runtime-settings-unregistered-session',
      patch: {
        interactionMode: 'plan',
      },
    })

    expect(result.applied).toBe(true)
  })

  it('reports idle settings as unapplied when the runtime hook fails', async () => {
    insertSession({
      sessionId: 'idle-runtime-settings-failure-session',
    })
    const updateRuntimeSettings = vi.fn(async () => {
      throw new Error('settings update failed')
    })
    registerLiveRuntimeSession({
      sessionId: 'idle-runtime-settings-failure-session',
      updateRuntimeSettings,
    })

    const result = await updateSessionRuntimeSettings({
      sessionId: 'idle-runtime-settings-failure-session',
      patch: {
        accessMode: 'full-access',
      },
    })

    expect(result.applied).toBe(false)
    expect(updateRuntimeSettings).toHaveBeenCalledOnce()
  })
})
