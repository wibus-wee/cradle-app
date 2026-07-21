import { describe, expect, it } from 'vitest'

import { kimiProviderTargetHostScopeId } from './host-lease'

describe('kimi host lease scope', () => {
  it('is provider-target scoped and never session scoped', () => {
    const scope = kimiProviderTargetHostScopeId('target-a')
    expect(scope).toBe('provider-target:target-a')
    expect(scope).not.toContain('chat-session')
    expect(scope).toBe(kimiProviderTargetHostScopeId('target-a'))
    expect(scope).not.toBe(kimiProviderTargetHostScopeId('target-b'))
  })
})
