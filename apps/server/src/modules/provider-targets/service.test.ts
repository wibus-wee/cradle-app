import { describe, expect, it } from 'vitest'

import { toOpenCodeRuntimeNativeProviderTargetId } from '../chat-runtime-providers/opencode/native-provider-target-id'
import {
  assertProviderTargetCompatibleWithRuntime,
  resolveProviderTarget,
} from './service'

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
})
