import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, providerTargets, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import type { ChatRuntime, ResumeChatSessionInput, RuntimeProviderTargetProfile, RuntimeSession, StartChatSessionInput } from '../src/modules/chat-runtime/runtime-provider-types'
import { providerRuntimeHostManager } from '../src/modules/provider-runtime/host-manager'
import {
  persistProviderRuntimeResolution,
  resolveExistingProviderRuntimeSession,
  resolveProviderRuntimeSession,
  unlinkProviderTargetFromDurableProviderRuntimeBindings,
} from '../src/modules/provider-runtime/service'
import {
  clearSideConversations,
  readSideConversation,
  registerSideConversation,
  releaseSideConversationsByProviderTargetId,
  reserveSideConversationHostLease,
} from '../src/modules/provider-runtime/side-conversation-registry'
import type { RuntimeKind } from '../src/modules/provider-contracts/types'

const runtimeSession: RuntimeSession = {
  id: 'side-session',
  chatSessionId: 'side-session',
  providerTargetId: 'provider-target',
  runtimeKind: 'codex',
  providerSessionId: 'provider-thread',
  providerStateSnapshot: '{"models":{"currentModelId":"gpt-5-codex"}}',
}

afterEach(() => {
  vi.useRealTimers()
  clearSideConversations()
  providerRuntimeHostManager.shutdown()
  shutdownInfra()
})

function createTestProfile(providerTargetId = 'provider-target'): RuntimeProviderTargetProfile {
  return {
    id: 'profile',
    name: 'Profile',
    providerKind: 'openai-compatible',
    enabled: true,
    configJson: '{}',
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId,
  }
}

function createTestRuntime() {
  const runtime = {
    runtimeKind: 'codex' as const,
    metadata: {
      label: 'Test Codex',
      providerKinds: ['openai-compatible'],
    },
    capabilities: {
      supportsSteerTurn: false,
      supportsShellExecution: false,
      supportsLastTurnRollback: false,
      supportsRuntimeSettings: false,
      supportsUiSlotStates: false,
      supportsDynamicCapabilities: false,
      supportsTitleGeneration: false,
      sessionModelSwitch: 'in-session',
    },
    startChatSession: vi.fn(async (input: StartChatSessionInput): Promise<RuntimeSession> => ({
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `started-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({ models: { currentModelId: input.modelId ?? null } }),
    })),
    resumeChatSession: vi.fn(async (input: ResumeChatSessionInput): Promise<RuntimeSession> => input.runtimeSession),
    async* streamTurn() {},
    cancelTurn: vi.fn(async () => undefined),
  } satisfies ChatRuntime
  return runtime
}

function registerTestSideConversation(input: {
  sideConversationId?: string
  parentSessionId?: string
  providerTargetId?: string
  runtimeKind?: RuntimeKind
  runtimeSession?: RuntimeSession
  requestedModelId?: string | null
  ttlMs?: number
} = {}) {
  const sideConversationId = input.sideConversationId ?? 'side-session'
  const providerTargetId = input.providerTargetId ?? 'provider-target'
  const runtimeKind = input.runtimeKind ?? 'codex'
  return registerSideConversation({
    sideConversationId,
    parentSessionId: input.parentSessionId ?? 'parent-session',
    providerTargetId,
    runtimeKind,
    runtimeSession: input.runtimeSession ?? runtimeSession,
    requestedModelId: input.requestedModelId ?? 'gpt-5-codex',
    ttlMs: input.ttlMs,
    hostLease: reserveSideConversationHostLease({
      sideConversationId,
      providerTargetId,
      runtimeKind,
      ttlMs: input.ttlMs,
    }),
  })
}

async function withDataDir<T>(run: () => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-provider-runtime-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir
  try {
    return await run()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  }
}

describe('provider runtime side conversations', () => {
  it('holds a pinned host lease for live-only side conversations', () => {
    registerTestSideConversation({
      ttlMs: 1_000,
    })

    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        runtimeKind: 'codex',
        providerTargetId: 'provider-target',
        scopeId: 'side-session',
        refCount: 1,
        pinnedCount: 1,
      }),
    ])
  })

  it('releases the pinned host lease after side conversation TTL expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    registerTestSideConversation({
      ttlMs: 1,
    })

    expect(readSideConversation('side-session')).toBeDefined()
    vi.setSystemTime(1_002)

    expect(readSideConversation('side-session')).toBeUndefined()
    expect(providerRuntimeHostManager.listHosts()).toEqual([])
  })

  it('drops side conversation records when the pinned host has already been cleared', async () => {
    const disposeResource = vi.fn()

    const resourceLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'side-session',
      pinned: true,
      createResource: () => ({ id: 'resource-1' }),
      disposeResource,
    })
    registerTestSideConversation({
      ttlMs: 30 * 60 * 1000,
    })
    resourceLease.release()

    providerRuntimeHostManager.clear()

    expect(disposeResource).toHaveBeenCalledOnce()
    expect(readSideConversation('side-session')).toBeUndefined()
    expect(providerRuntimeHostManager.listHosts()).toEqual([])
  })

  it('releases side conversations for a removed provider target', () => {
    registerTestSideConversation({
      ttlMs: 1_000,
    })
    registerTestSideConversation({
      sideConversationId: 'side-session-other-target',
      providerTargetId: 'provider-target-other',
      runtimeSession: {
        ...runtimeSession,
        id: 'side-session-other-target',
        chatSessionId: 'side-session-other-target',
        providerTargetId: 'provider-target-other',
      },
      ttlMs: 1_000,
    })

    releaseSideConversationsByProviderTargetId('provider-target')

    expect(readSideConversation('side-session')).toBeUndefined()
    expect(readSideConversation('side-session-other-target')).toBeDefined()
    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        providerTargetId: 'provider-target-other',
        scopeId: 'side-session-other-target',
      }),
    ])
  })

  it('rejects side registration with a mismatched pre-reserved host lease', () => {
    const hostLease = reserveSideConversationHostLease({
      sideConversationId: 'other-side-session',
      providerTargetId: 'provider-target',
      runtimeKind: 'codex',
    })

    expect(() => registerSideConversation({
      sideConversationId: 'side-session',
      parentSessionId: 'parent-session',
      providerTargetId: 'provider-target',
      runtimeKind: 'codex',
      runtimeSession,
      requestedModelId: 'gpt-5-codex',
      hostLease,
    })).toThrow('Reserved side conversation host lease does not match side conversation')
    expect(providerRuntimeHostManager.listHosts()).toEqual([])
  })
})

describe('provider runtime session resolution', () => {
  it('resolves live side conversations without durable bindings', async () => {
    await withDataDir(async () => {
      const runtime = createTestRuntime()
      registerTestSideConversation({
        ttlMs: 1_000,
      })

      const resolved = await resolveExistingProviderRuntimeSession({
        chatSessionId: 'side-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'codex',
        runtime,
        profile: createTestProfile(),
        workspacePath: '/workspace',
        agentId: null,
      })

      expect(resolved).toEqual(expect.objectContaining({
        source: 'live-side',
        binding: undefined,
        requestedModelId: 'gpt-5-codex',
      }))
      expect(resolved?.runtimeSession.providerSessionId).toBe('provider-thread')
      expect(runtime.startChatSession).not.toHaveBeenCalled()
      expect(runtime.resumeChatSession).not.toHaveBeenCalled()
    })
  })

  it('resumes durable bindings through the existing-only resolver', async () => {
    await withDataDir(async () => {
      const runtime = createTestRuntime()
      db().insert(providerTargets).values({
        id: 'provider-target',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Provider Target',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(sessions).values({
        id: 'durable-session',
        workspaceId: null,
        title: 'Durable Session',
        providerTargetId: 'provider-target',
        runtimeKind: 'codex',
        agentId: null,
        configJson: '{}',
        linkedIssueId: null,
        pinned: 0,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(backendSessionBindings).values({
        id: 'binding-session',
        chatSessionId: 'durable-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'codex',
        backendSessionId: 'provider-thread-durable',
        backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-durable' } }),
        requestedModelId: 'gpt-durable',
        createdAt: 1,
        updatedAt: 1,
      }).run()

      const resolved = await resolveExistingProviderRuntimeSession({
        chatSessionId: 'durable-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'codex',
        runtime,
        profile: createTestProfile(),
        workspacePath: '/workspace',
        agentId: null,
      })

      expect(resolved).toEqual(expect.objectContaining({
        source: 'durable-binding',
        requestedModelId: 'gpt-durable',
      }))
      expect(resolved?.runtimeSession.providerSessionId).toBe('provider-thread-durable')
      expect(runtime.resumeChatSession).toHaveBeenCalledOnce()
      expect(runtime.startChatSession).not.toHaveBeenCalled()
    })
  })

  it('does not start a provider session for existing-only misses', async () => {
    await withDataDir(async () => {
      const runtime = createTestRuntime()
      const resolved = await resolveExistingProviderRuntimeSession({
        chatSessionId: 'missing-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'codex',
        runtime,
        profile: createTestProfile(),
        workspacePath: '/workspace',
        agentId: null,
      })

      expect(resolved).toBeNull()
      expect(runtime.startChatSession).not.toHaveBeenCalled()
      expect(runtime.resumeChatSession).not.toHaveBeenCalled()
    })
  })

  it('does not treat legacy non-resumable directory rows as durable bindings', async () => {
    await withDataDir(async () => {
      const runtime = createTestRuntime()
      db().insert(providerTargets).values({
        id: 'provider-target',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Provider Target',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(sessions).values({
        id: 'legacy-session',
        workspaceId: null,
        title: 'Legacy Session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        agentId: null,
        configJson: '{}',
        linkedIssueId: null,
        pinned: 0,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(backendSessionBindings).values({
        id: 'binding-legacy',
        chatSessionId: 'legacy-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        backendSessionId: null,
        backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-legacy' } }),
        requestedModelId: 'gpt-legacy',
        createdAt: 1,
        updatedAt: 1,
      }).run()

      const resolved = await resolveExistingProviderRuntimeSession({
        chatSessionId: 'legacy-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        runtime,
        profile: createTestProfile(),
        workspacePath: '/workspace',
        agentId: null,
      })

      expect(resolved).toBeNull()
      expect(runtime.startChatSession).not.toHaveBeenCalled()
      expect(runtime.resumeChatSession).not.toHaveBeenCalled()
    })
  })

  it('starts fresh sessions without legacy non-resumable directory snapshot input', async () => {
    await withDataDir(async () => {
      const runtime = createTestRuntime()
      db().insert(providerTargets).values({
        id: 'provider-target',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Provider Target',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(sessions).values({
        id: 'legacy-session',
        workspaceId: null,
        title: 'Legacy Session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        agentId: null,
        configJson: '{}',
        linkedIssueId: null,
        pinned: 0,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(backendSessionBindings).values({
        id: 'binding-legacy',
        chatSessionId: 'legacy-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        backendSessionId: null,
        backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-legacy' } }),
        requestedModelId: 'gpt-legacy',
        createdAt: 1,
        updatedAt: 1,
      }).run()

      const resolved = await resolveProviderRuntimeSession({
        chatSessionId: 'legacy-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        runtime,
        profile: createTestProfile(),
        workspacePath: '/workspace',
        agentId: null,
      })

      expect(resolved).toEqual(expect.objectContaining({
        source: 'new-session',
        binding: undefined,
        requestedModelId: null,
      }))
      expect(runtime.startChatSession).toHaveBeenCalledWith(expect.objectContaining({
        previousProviderStateSnapshot: null,
        modelId: undefined,
      }))
      expect(runtime.resumeChatSession).not.toHaveBeenCalled()
    })
  })

  it('does not persist durable directory rows without a resumable provider session id', async () => {
    await withDataDir(async () => {
      db().insert(providerTargets).values({
        id: 'provider-target',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Provider Target',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(sessions).values({
        id: 'durable-session',
        workspaceId: null,
        title: 'Durable Session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        agentId: null,
        configJson: '{}',
        linkedIssueId: null,
        pinned: 0,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(backendSessionBindings).values({
        id: 'binding-stale',
        chatSessionId: 'durable-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'codex',
        backendSessionId: 'provider-thread-stale',
        backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-stale' } }),
        requestedModelId: 'gpt-stale',
        createdAt: 1,
        updatedAt: 1,
      }).run()

      const binding = persistProviderRuntimeResolution({
        chatSessionId: 'durable-session',
        providerTargetId: 'provider-target',
        runtimeKind: 'standard',
        runtimeSession: {
          id: 'durable-session',
          chatSessionId: 'durable-session',
          providerTargetId: 'provider-target',
          runtimeKind: 'standard',
          providerSessionId: null,
          providerStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-4o-mini' } }),
        },
        requestedModelId: 'gpt-4o-mini',
        durable: true,
      })

      expect(binding).toBeUndefined()
      expect(db()
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.chatSessionId, 'durable-session'))
        .get()).toBeUndefined()
    })
  })

  it('unlinks provider targets from provider runtime bindings', async () => {
    await withDataDir(async () => {
      db().insert(providerTargets).values({
        id: 'provider-target',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Provider Target',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      }).run()
      db().insert(sessions).values([
        {
          id: 'durable-session',
          workspaceId: null,
          title: 'Durable Session',
          providerTargetId: 'provider-target',
          runtimeKind: 'codex',
          agentId: null,
          configJson: '{}',
          linkedIssueId: null,
          pinned: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'legacy-session',
          workspaceId: null,
          title: 'Legacy Session',
          providerTargetId: 'provider-target',
          runtimeKind: 'codex',
          agentId: null,
          configJson: '{}',
          linkedIssueId: null,
          pinned: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ]).run()
      db().insert(backendSessionBindings).values([
        {
          id: 'binding-durable',
          chatSessionId: 'durable-session',
          providerTargetId: 'provider-target',
          runtimeKind: 'codex',
          backendSessionId: 'provider-thread-durable',
          backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-durable' } }),
          requestedModelId: 'gpt-durable',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'binding-legacy',
          chatSessionId: 'legacy-session',
          providerTargetId: 'provider-target',
          runtimeKind: 'codex',
          backendSessionId: null,
          backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-legacy' } }),
          requestedModelId: 'gpt-legacy',
          createdAt: 1,
          updatedAt: 1,
        },
      ]).run()

      unlinkProviderTargetFromDurableProviderRuntimeBindings({ providerTargetId: 'provider-target' })

      expect(db()
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.id, 'binding-durable'))
        .get()).toEqual(expect.objectContaining({
          providerTargetId: null,
          backendSessionId: 'provider-thread-durable',
        }))
      expect(db()
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.id, 'binding-legacy'))
        .get()).toEqual(expect.objectContaining({
          providerTargetId: null,
          backendSessionId: null,
        }))
    })
  })
})

describe('provider runtime hosts', () => {
  it('reuses one resource for the same host key until all leases are released', async () => {
    const createResource = vi.fn(() => ({ id: 'resource-1' }))
    const disposeResource = vi.fn()

    const firstLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'session-1',
      createResource,
      disposeResource,
    })
    const secondLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'session-1',
      createResource,
      disposeResource,
    })

    expect(createResource).toHaveBeenCalledOnce()
    expect(firstLease.resource).toBe(secondLease.resource)
    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        scopeId: 'session-1',
        refCount: 2,
        pinnedCount: 0,
        hasResource: true,
      }),
    ])

    firstLease.release()
    expect(disposeResource).not.toHaveBeenCalled()

    secondLease.release()
    expect(disposeResource).toHaveBeenCalledOnce()
    expect(disposeResource).toHaveBeenCalledWith(firstLease.resource)
    expect(providerRuntimeHostManager.listHosts()).toEqual([])
  })

  it('retains resources while pinned leases are alive', async () => {
    const resource = { id: 'resource-1' }
    const disposeResource = vi.fn()

    const pinnedLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'side-session',
      pinned: true,
      createResource: () => resource,
      disposeResource,
    })
    const transientLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'side-session',
      createResource: () => ({ id: 'unused' }),
      disposeResource,
    })

    transientLease.release()

    expect(disposeResource).not.toHaveBeenCalled()
    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        scopeId: 'side-session',
        refCount: 1,
        pinnedCount: 1,
        hasResource: true,
      }),
    ])

    pinnedLease.release()
    expect(disposeResource).toHaveBeenCalledOnce()
    expect(disposeResource).toHaveBeenCalledWith(resource)
  })

  it('recreates idle resources when the compatibility fingerprint changes', async () => {
    const firstResource = { id: 'resource-1' }
    const secondResource = { id: 'resource-2' }
    const createResource = vi.fn()
      .mockReturnValueOnce(firstResource)
      .mockReturnValueOnce(secondResource)
    const disposeResource = vi.fn()

    const firstLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'session-1',
      resourceFingerprint: 'auth:first',
      createResource,
      disposeResource,
    })

    firstLease.release()

    const secondLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'session-1',
      resourceFingerprint: 'auth:second',
      createResource,
      disposeResource,
    })

    expect(createResource).toHaveBeenCalledTimes(2)
    expect(disposeResource).toHaveBeenCalledWith(firstResource)
    expect(secondLease.resource).toBe(secondResource)

    secondLease.release()
    expect(disposeResource).toHaveBeenCalledWith(secondResource)
  })

  it('rejects incompatible resource fingerprints while a lease is active', async () => {
    const createResource = vi.fn(() => ({ id: 'resource-1' }))
    const disposeResource = vi.fn()

    const activeLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'session-1',
      resourceFingerprint: 'auth:first',
      createResource,
      disposeResource,
    })

    await expect(providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'session-1',
      resourceFingerprint: 'auth:second',
      createResource,
      disposeResource,
    })).rejects.toThrow('incompatible options')

    expect(createResource).toHaveBeenCalledOnce()
    expect(disposeResource).not.toHaveBeenCalled()

    activeLease.release()
    expect(disposeResource).toHaveBeenCalledOnce()
  })

  it('disposes pinned-only resources when TTL expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const resource = { id: 'resource-1' }
    const disposeResource = vi.fn()

    const lease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'expiring-session',
      ttlMs: 1,
      pinned: true,
      createResource: () => resource,
      disposeResource,
    })

    vi.setSystemTime(1_002)
    providerRuntimeHostManager.reapIdleHosts()

    expect(disposeResource).toHaveBeenCalledOnce()
    expect(disposeResource).toHaveBeenCalledWith(resource)
    expect(providerRuntimeHostManager.listHosts()).toEqual([])

    lease.release()
    expect(disposeResource).toHaveBeenCalledOnce()
    expect(providerRuntimeHostManager.listHosts()).toEqual([])
  })

  it('reaps expired pinned-only hosts in the background', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const resource = { id: 'resource-1' }
    const disposeResource = vi.fn()

    const lease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'reaped-session',
      ttlMs: 1,
      pinned: true,
      createResource: () => resource,
      disposeResource,
    })

    providerRuntimeHostManager.startReaper(10)
    vi.setSystemTime(1_002)
    vi.advanceTimersByTime(10)

    expect(disposeResource).toHaveBeenCalledOnce()
    expect(disposeResource).toHaveBeenCalledWith(resource)
    expect(providerRuntimeHostManager.listHosts()).toEqual([])

    lease.release()
    expect(disposeResource).toHaveBeenCalledOnce()
    expect(providerRuntimeHostManager.listHosts()).toEqual([])
  })

  it('does not reap expired hosts while transient active leases are held', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const resource = { id: 'resource-1' }
    const disposeResource = vi.fn()

    const pinnedLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'active-session',
      ttlMs: 1,
      pinned: true,
      createResource: () => resource,
      disposeResource,
    })
    const activeLease = providerRuntimeHostManager.acquireLease({
      runtimeKind: 'codex',
      providerTargetId: 'provider-target',
      scopeId: 'active-session',
      ttlMs: 1,
    })

    vi.setSystemTime(1_002)
    providerRuntimeHostManager.reapIdleHosts()

    expect(disposeResource).not.toHaveBeenCalled()
    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        scopeId: 'active-session',
        refCount: 2,
        pinnedCount: 1,
      }),
    ])

    activeLease.release()
    expect(disposeResource).not.toHaveBeenCalled()

    pinnedLease.release()
    expect(disposeResource).toHaveBeenCalledOnce()
  })
})
