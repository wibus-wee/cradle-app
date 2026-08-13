import {
  agentCredentials,
  providerExtensionBindings,
  providerTargets,
} from '@cradle/db'
import type { ProviderExtension } from '@cradle/plugin-sdk/server'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../infra'
import {
  registerProviderExtension,
  resetProviderExtensionRegistry,
} from '../../plugins/provider-extension-registry'
import { readSecret, resetCredentialKeyringForTests, saveSecret } from '../secrets/service'
import { resetProviderExtensionLifecycleListenersForTests, subscribeProviderExtensionLifecycle } from './events'
import { configureProviderExtensionHost } from './host'
import {
  listProviderTargetExtensions,
  readEffectiveProviderKinds,
  readProviderExtensionRuntimeRoute,
  reconcileProviderExtensionsForOwner,
  resetProviderExtensionOperationsForTests,
  setProviderTargetExtensionEnabled,
  suspendProviderExtensionsForOwner,
} from './service'

const TARGET_ID = 'provider-extension-test-target'
const OWNER = '@cradle/provider-extension-test'

function insertTarget(credentialRef: string): void {
  db().insert(providerTargets).values({
    id: TARGET_ID,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: 'Test Provider',
    enabled: true,
    connectionConfigJson: JSON.stringify({ baseUrl: 'https://example.test/v1' }),
    credentialRef,
    enabledModelsJson: JSON.stringify(['model-a']),
    customModelsJson: '[]',
  }).run()
}

function borrowedExtension(): ProviderExtension {
  return {
    id: 'borrowed',
    label: 'Borrowed bridge',
    conversions: [{
      fromProviderKind: 'openai-compatible',
      routedProviderKinds: ['anthropic'],
      addedProviderKinds: ['anthropic'],
    }],
    getApplicability: target => target.credentialKind === 'api-key'
      ? { applicable: true, credentialStrategy: 'borrowed-static' }
      : { applicable: false, reason: 'API key required' },
    onEnable: async ({ sourceCredential }) => ({
      providerKinds: ['anthropic'],
      state: { prefix: 'binding-a' },
      outputCredential: {
        kind: 'api-key',
        label: 'Provider extension output',
        value: `output-${sourceCredential?.value}`,
      },
    }),
    onDisable: async () => {},
    onReconcile: async ({ sourceCredential }) => ({
      providerKinds: ['anthropic'],
      state: { prefix: 'binding-a' },
      outputCredential: {
        kind: 'api-key',
        label: 'Provider extension output',
        value: `output-${sourceCredential?.value}`,
      },
    }),
    resolveRuntime: ({ publicModelId }) => ({
      providerKind: 'anthropic',
      config: { baseUrl: 'http://127.0.0.1:8317' },
      effectiveModelId: `binding-a/${publicModelId}`,
    }),
  }
}

describe('provider extension lifecycle', () => {
  beforeEach(() => {
    process.env.CRADLE_CREDENTIAL_SECRET = 'provider-extension-test-secret'
    resetCredentialKeyringForTests()
    configureProviderExtensionHost({
      findActiveRunId: () => null,
      releaseRuntimeSessions: () => {},
      validateRefreshableCredential: (_credentialRef, value) => value.includes('chatgptAccountId'),
    })
    db().delete(providerExtensionBindings).run()
    db().delete(providerTargets).where(eq(providerTargets.id, TARGET_ID)).run()
    db().delete(agentCredentials).run()
  })

  afterEach(() => {
    resetProviderExtensionRegistry()
    resetProviderExtensionLifecycleListenersForTests()
    resetProviderExtensionOperationsForTests()
    db().delete(providerExtensionBindings).run()
    db().delete(providerTargets).where(eq(providerTargets.id, TARGET_ID)).run()
    db().delete(agentCredentials).run()
    resetCredentialKeyringForTests()
  })

  it('enables and disables a borrowed extension on the existing Provider', async () => {
    const source = saveSecret({ kind: 'api-key', label: 'Source', secret: 'sk-source' })
    insertTarget(source.id)
    const extension = borrowedExtension()
    const onDisable = vi.spyOn(extension, 'onDisable')
    registerProviderExtension(OWNER, extension)
    const events: string[] = []
    subscribeProviderExtensionLifecycle(() => {
      throw new Error('notification failure')
    })
    subscribeProviderExtensionLifecycle(event => events.push(event.type))

    const enabled = await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: true,
    })

    expect(enabled).toMatchObject({
      providerTargetId: TARGET_ID,
      status: 'enabled',
      desiredEnabled: true,
      providerKinds: ['anthropic'],
    })
    expect(db().select().from(providerTargets).where(eq(providerTargets.id, TARGET_ID)).all()).toHaveLength(1)
    expect(readProviderExtensionRuntimeRoute({
      providerTargetId: TARGET_ID,
      acceptedProviderKinds: ['anthropic'],
      publicModelId: 'model-a',
    })).toMatchObject({
      providerKind: 'anthropic',
      effectiveModelId: 'binding-a/model-a',
    })

    configureProviderExtensionHost({
      findActiveRunId: () => 'active-run-a',
      releaseRuntimeSessions: () => {},
      validateRefreshableCredential: (_credentialRef, value) => value.includes('chatgptAccountId'),
    })
    await expect(setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: false,
    })).rejects.toMatchObject({ status: 409, code: 'provider_extension_active_run_conflict' })
    configureProviderExtensionHost({
      findActiveRunId: () => null,
      releaseRuntimeSessions: () => {},
      validateRefreshableCredential: (_credentialRef, value) => value.includes('chatgptAccountId'),
    })

    const disabled = await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: false,
    })
    expect(disabled.status).toBe('disabled')
    expect(onDisable).toHaveBeenCalledWith(expect.objectContaining({ reason: 'user-disabled' }))
    expect(events).toEqual(['enabling', 'enabled', 'disabling', 'disabled'])
    expect(listProviderTargetExtensions(TARGET_ID)).toHaveLength(1)
  })

  it('leases and losslessly returns a refreshable credential', async () => {
    const initialCredential = JSON.stringify({
      kind: 'chatgpt-auth',
      chatgptAccountId: 'account-a',
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    })
    const refreshedCredential = JSON.stringify({
      kind: 'chatgpt-auth',
      chatgptAccountId: 'account-a',
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    })
    const source = saveSecret({ kind: 'chatgpt-auth', label: 'Codex OAuth', secret: initialCredential })
    insertTarget(source.id)
    let stagedCredential = ''
    let releaseAttempts = 0
    let exclusiveApplicable = true
    const extension: ProviderExtension = {
      id: 'exclusive',
      label: 'Exclusive bridge',
      conversions: [{
        fromProviderKind: 'openai-compatible',
        routedProviderKinds: ['openai-compatible', 'anthropic'],
        addedProviderKinds: ['anthropic'],
      }],
      getApplicability: target => exclusiveApplicable && target.credentialKind === 'chatgpt-auth'
        ? { applicable: true, credentialStrategy: 'exclusive-refreshable' }
        : { applicable: false, reason: 'Codex OAuth runtime unavailable' },
      credentialLease: {
        prepareAcquire: async ({ sourceCredential }) => {
          stagedCredential = sourceCredential.value
          return { leaseState: { staged: true } }
        },
        commitAcquire: async () => {},
        prepareRelease: async () => ({
          credential: { kind: 'chatgpt-auth', value: refreshedCredential },
          leaseState: { staged: false },
        }),
        commitRelease: async () => {
          releaseAttempts += 1
          if (releaseAttempts === 1) {
            throw new Error('simulated commitRelease crash')
          }
          stagedCredential = ''
        },
      },
      onEnable: async () => ({
        providerKinds: ['openai-compatible', 'anthropic'],
        state: { prefix: 'oauth-a' },
        outputCredential: { kind: 'api-key', label: 'Output', value: 'output-key' },
      }),
      onDisable: async () => {},
      onReconcile: async () => ({
        providerKinds: ['openai-compatible', 'anthropic'],
        state: { prefix: 'oauth-a' },
        outputCredential: { kind: 'api-key', label: 'Output', value: 'output-key' },
      }),
      resolveRuntime: ({ runtimeProviderKinds }) => ({
        providerKind: runtimeProviderKinds[0]!,
        config: {},
      }),
    }
    registerProviderExtension(OWNER, extension)

    const enabled = await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: true,
    })
    expect(enabled.credentialOwner).toBe('extension')
    expect(stagedCredential).toBe(initialCredential)
    expect(() => readSecret(source.id)).toThrow('temporarily owned')
    exclusiveApplicable = false
    expect(readEffectiveProviderKinds(TARGET_ID, 'openai-compatible')).toEqual([])
    exclusiveApplicable = true

    await expect(setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: false,
    })).rejects.toMatchObject({ status: 409, code: 'provider_extension_cleanup_failed' })
    expect(readSecret(source.id)).toBe(refreshedCredential)
    expect(stagedCredential).toBe(initialCredential)

    const disabled = await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: false,
    })
    expect(disabled.credentialOwner).toBe('host')
    expect(stagedCredential).toBe('')
    expect(readSecret(source.id)).toBe(refreshedCredential)
    expect(releaseAttempts).toBe(2)
  })

  it('rejects overlapping output kinds without invoking the second extension', async () => {
    const source = saveSecret({ kind: 'api-key', label: 'Source', secret: 'sk-source' })
    insertTarget(source.id)
    const first = borrowedExtension()
    const second = { ...borrowedExtension(), id: 'borrowed-two', label: 'Second bridge' }
    const secondEnable = vi.spyOn(second, 'onEnable')
    registerProviderExtension(OWNER, first)
    registerProviderExtension('@cradle/provider-extension-two', second)

    await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: first.id,
      enabled: true,
    })

    await expect(setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: '@cradle/provider-extension-two',
      id: second.id,
      enabled: true,
    })).rejects.toMatchObject({ status: 409, code: 'provider_extension_kind_conflict' })
    expect(secondEnable).not.toHaveBeenCalled()
  })

  it('removes an enabled extension from routing when applicability changes', async () => {
    const source = saveSecret({ kind: 'api-key', label: 'Source', secret: 'sk-source' })
    insertTarget(source.id)
    let applicable = true
    const extension = borrowedExtension()
    extension.getApplicability = () => applicable
      ? { applicable: true, credentialStrategy: 'borrowed-static' }
      : { applicable: false, reason: 'Runtime version changed' }
    const onDisable = vi.spyOn(extension, 'onDisable')
    registerProviderExtension(OWNER, extension)

    await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: true,
    })
    expect(readEffectiveProviderKinds(TARGET_ID, 'openai-compatible'))
      .toEqual(['openai-compatible', 'anthropic'])

    applicable = false

    expect(listProviderTargetExtensions(TARGET_ID)[0]).toMatchObject({
      applicable: false,
      desiredEnabled: true,
      status: 'suspended',
    })
    expect(readEffectiveProviderKinds(TARGET_ID, 'openai-compatible'))
      .toEqual(['openai-compatible'])
    expect(readProviderExtensionRuntimeRoute({
      providerTargetId: TARGET_ID,
      acceptedProviderKinds: ['anthropic'],
    })).toBeNull()

    await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: false,
    })
    expect(onDisable).toHaveBeenCalledWith(expect.objectContaining({ reason: 'user-disabled' }))
  })

  it('rejects a second exclusive credential lease even when output kinds do not overlap', async () => {
    const source = saveSecret({
      kind: 'chatgpt-auth',
      label: 'Codex OAuth',
      secret: JSON.stringify({
        kind: 'chatgpt-auth',
        chatgptAccountId: 'account-a',
        accessToken: 'access-a',
        refreshToken: 'refresh-a',
      }),
    })
    insertTarget(source.id)
    db().insert(providerExtensionBindings).values({
      id: 'existing-exclusive-binding',
      providerTargetId: TARGET_ID,
      extensionOwner: '@cradle/existing-exclusive',
      extensionId: 'existing-exclusive',
      desiredEnabled: true,
      status: 'enabled',
      credentialStrategy: 'exclusive-refreshable',
      credentialOwner: 'extension',
    }).run()
    const extension = borrowedExtension()
    extension.id = 'second-exclusive'
    extension.conversions = [{
      fromProviderKind: 'openai-compatible',
      routedProviderKinds: ['universal'],
      addedProviderKinds: ['universal'],
    }]
    extension.getApplicability = () => ({
      applicable: true,
      credentialStrategy: 'exclusive-refreshable',
    })
    extension.credentialLease = {
      prepareAcquire: async () => ({ leaseState: {} }),
      commitAcquire: async () => {},
      prepareRelease: async () => ({
        credential: { kind: 'chatgpt-auth', value: '{}' },
        leaseState: {},
      }),
      commitRelease: async () => {},
    }
    registerProviderExtension(OWNER, extension)

    await expect(setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: true,
    })).rejects.toMatchObject({
      status: 409,
      code: 'provider_extension_credential_lease_conflict',
    })
  })

  it('suspends on plugin Disable and reconciles the desired binding after reactivation', async () => {
    const source = saveSecret({ kind: 'api-key', label: 'Source', secret: 'sk-source' })
    insertTarget(source.id)
    const extension = borrowedExtension()
    const onDisable = vi.spyOn(extension, 'onDisable')
    const onReconcile = vi.spyOn(extension, 'onReconcile')
    registerProviderExtension(OWNER, extension)
    await setProviderTargetExtensionEnabled({
      providerTargetId: TARGET_ID,
      owner: OWNER,
      id: extension.id,
      enabled: true,
    })

    await suspendProviderExtensionsForOwner(OWNER)
    expect(listProviderTargetExtensions(TARGET_ID)[0]).toMatchObject({
      desiredEnabled: true,
      status: 'suspended',
    })
    expect(onDisable).toHaveBeenCalledWith(expect.objectContaining({ reason: 'plugin-disabled' }))

    await reconcileProviderExtensionsForOwner(OWNER)
    expect(listProviderTargetExtensions(TARGET_ID)[0]).toMatchObject({
      desiredEnabled: true,
      status: 'enabled',
    })
    expect(onReconcile).toHaveBeenCalledOnce()
  })
})
