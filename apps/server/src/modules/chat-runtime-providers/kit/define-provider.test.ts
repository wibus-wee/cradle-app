import { describe, expect, it } from 'vitest'

import type { ChatRuntimeCapabilities } from '../../chat-runtime/runtime-provider-types'
import { defineChatRuntime } from './define-provider'

const baseCapabilities = {
  steer: 'unsupported',
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'unsupported',
} satisfies ChatRuntimeCapabilities

describe('defineChatRuntime', () => {
  it('accepts a runtime whose hooks satisfy its declared capabilities', () => {
    const runtime = defineChatRuntime({
      runtimeKind: 'test-define-provider',
      metadata: { label: 'Test', providerKinds: ['openai-compatible'] },
      capabilities: { ...baseCapabilities, steer: 'native', supportsShellExecution: true },
      steerTurn: async () => undefined,
      executeShellCommand: async () => ({
        command: 'echo test',
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
        timedOut: false,
        truncated: false,
      }),
      startChatSession: async input => ({
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: null,
        runtimeKind: 'test-define-provider',
        providerSessionId: null,
        providerStateSnapshot: JSON.stringify({ models: { currentModelId: null } }),
      }),
      resumeChatSession: async input => input.runtimeSession,
      async* streamTurn() {},
      cancelTurn: async () => undefined,
    })

    expect(runtime.runtimeKind).toBe('test-define-provider')
    expect(typeof runtime.steerTurn).toBe('function')
    expect(typeof runtime.executeShellCommand).toBe('function')
  })

  it('does not require capability-gated hooks when the capability is not declared', () => {
    const runtime = defineChatRuntime({
      runtimeKind: 'test-define-provider-minimal',
      metadata: { label: 'Test Minimal', providerKinds: ['openai-compatible'] },
      capabilities: baseCapabilities,
      startChatSession: async input => ({
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: null,
        runtimeKind: 'test-define-provider-minimal',
        providerSessionId: null,
        providerStateSnapshot: JSON.stringify({ models: { currentModelId: null } }),
      }),
      resumeChatSession: async input => input.runtimeSession,
      async* streamTurn() {},
      cancelTurn: async () => undefined,
    })

    expect(runtime.steerTurn).toBeUndefined()
    expect(runtime.executeShellCommand).toBeUndefined()
  })

  it('rejects at compile time a runtime that declares a capability without its hook', () => {
    // @ts-expect-error `supportsShellExecution: true` requires an `executeShellCommand` hook.
    defineChatRuntime({
      runtimeKind: 'test-define-provider-missing-hook',
      metadata: { label: 'Test Missing Hook', providerKinds: ['openai-compatible'] },
      capabilities: { ...baseCapabilities, supportsShellExecution: true },
      startChatSession: async input => ({
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: null,
        runtimeKind: 'test-define-provider-missing-hook',
        providerSessionId: null,
        providerStateSnapshot: JSON.stringify({ models: { currentModelId: null } }),
      }),
      resumeChatSession: async input => input.runtimeSession,
      async* streamTurn() {},
      cancelTurn: async () => undefined,
    })
  })
})
