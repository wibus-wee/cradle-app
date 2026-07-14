import { providerTargets } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../infra'
import { toOpenCodeRuntimeNativeProviderTargetId } from '../chat-runtime-providers/opencode/native-provider-target-id'
import { registerRuntimeProviderBinding } from '../provider-contracts/runtime-compatibility'
import {
  assertProviderTargetCompatibleWithRuntime,
  listProviderTargets,
  resolveProviderTarget,
} from './service'

const RUNTIME_OWNED_TEST_RUNTIME = 'runtime-owned-test'
const ORDINARY_PROVIDER_TARGET_ID = 'ordinary-provider'

afterEach(() => {
  registerRuntimeProviderBinding(RUNTIME_OWNED_TEST_RUNTIME, 'required')
  db().delete(providerTargets).where(eq(providerTargets.id, ORDINARY_PROVIDER_TARGET_ID)).run()
})

describe('runtime-owned provider targets', () => {
  it('projects runtime-owned provider targets and restricts them to their owner runtime', () => {
    const providerTargetId = toOpenCodeRuntimeNativeProviderTargetId('openai')
    const target = resolveProviderTarget(providerTargetId)

    expect(target).toEqual(expect.objectContaining({
      id: providerTargetId,
      kind: 'external',
      label: 'OpenCode / openai',
      providerKind: 'universal',
      enabled: true,
      iconSlug: 'opencode',
    }))

    expect(() => assertProviderTargetCompatibleWithRuntime(providerTargetId, 'opencode')).not.toThrow()
    expect(() => assertProviderTargetCompatibleWithRuntime(providerTargetId, 'standard')).toThrow(
      'Runtime-owned provider target is not compatible with the selected runtime',
    )
  })

  it('rejects ordinary provider targets for runtime-owned runtimes', () => {
    expect(() => assertProviderTargetCompatibleWithRuntime(ORDINARY_PROVIDER_TARGET_ID, 'opencode')).toThrow(
      'Runtime only supports runtime-owned provider targets',
    )
  })

  it('does not list ordinary provider targets for runtime-owned runtimes', async () => {
    db().insert(providerTargets).values({
      id: ORDINARY_PROVIDER_TARGET_ID,
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Ordinary Provider',
      enabled: true,
      connectionConfigJson: '{}',
      enabledModelsJson: '[]',
      customModelsJson: '[]',
    }).run()
    registerRuntimeProviderBinding(RUNTIME_OWNED_TEST_RUNTIME, 'runtime-owned')

    await expect(listProviderTargets({ runtimeKind: RUNTIME_OWNED_TEST_RUNTIME })).resolves.toEqual([])
  })
})
