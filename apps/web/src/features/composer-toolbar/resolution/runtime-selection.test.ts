import { describe, expect, it } from 'vitest'

import type { RuntimeKindOption } from '../constants'
import { readFallbackRuntimeKind, resolveComposerRuntimeKind } from './runtime-selection'

function runtime(value: string, overrides: Partial<RuntimeKindOption> = {}): RuntimeKindOption {
  return {
    value,
    label: overrides.label ?? value,
    description: overrides.description,
    icon: overrides.icon,
    iconKey: overrides.iconKey,
  }
}

describe('readFallbackRuntimeKind', () => {
  it('prefers the first direct runtime option from the server catalog', () => {
    expect(readFallbackRuntimeKind({
      directRuntimeOptions: [runtime('provider-runtime')],
      runtimeOptions: [runtime('terminal-runtime'), runtime('provider-runtime')],
    })).toBe('provider-runtime')
  })

  it('falls back to the first runtime option when no direct runtime is available', () => {
    expect(readFallbackRuntimeKind({
      directRuntimeOptions: [],
      runtimeOptions: [runtime('terminal-runtime')],
    })).toBe('terminal-runtime')
  })

  it('returns an empty runtime when the catalog has not loaded', () => {
    expect(readFallbackRuntimeKind({
      directRuntimeOptions: [],
      runtimeOptions: [],
    })).toBe('')
  })
})

describe('resolveComposerRuntimeKind', () => {
  const directRuntimeOptions = [runtime('provider-runtime')]

  it('uses the bound runtime for an existing chat session', () => {
    expect(resolveComposerRuntimeKind({
      context: 'chat',
      boundRuntimeKind: 'session-runtime',
      targetMode: 'provider',
      directRuntimeOptions,
      fallbackRuntimeKind: 'provider-runtime',
    })).toBe('session-runtime')
  })

  it('uses the catalog fallback for chat sessions without a bound runtime', () => {
    expect(resolveComposerRuntimeKind({
      context: 'chat',
      boundRuntimeKind: null,
      targetMode: 'provider',
      directRuntimeOptions,
      fallbackRuntimeKind: 'provider-runtime',
    })).toBe('provider-runtime')
  })

  it('uses the selected agent runtime in new-chat agent mode', () => {
    expect(resolveComposerRuntimeKind({
      context: 'new-chat',
      selectedAgentRuntimeKind: 'agent-runtime',
      targetMode: 'agent',
      directRuntimeOptions,
      fallbackRuntimeKind: 'provider-runtime',
    })).toBe('agent-runtime')
  })

  it('rejects stale manual provider runtime choices that are no longer catalog-selectable', () => {
    expect(resolveComposerRuntimeKind({
      context: 'new-chat',
      targetMode: 'provider',
      manualRuntimeKind: 'removed-runtime',
      directRuntimeOptions,
      fallbackRuntimeKind: 'provider-runtime',
    })).toBe('provider-runtime')
  })
})
