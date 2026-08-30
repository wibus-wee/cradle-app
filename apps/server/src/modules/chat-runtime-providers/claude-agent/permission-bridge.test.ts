import type {
  HookCallback,
  Options,
  PreModelSwitchHookInput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import type { GetCapabilitiesInput, StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import {
  createClaudeAgentPermissionBridgeState,
  createClaudeAgentPreModelSwitchHook,
  createClaudeAgentPreToolUseHook,
} from './permission-bridge'
import { CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE } from './plan-mode'

const ASK_USER_QUESTION_BYPASS_DENIAL
  = 'AskUserQuestion is unavailable in bypassPermissions mode; ask the user in plain text instead.'

describe('createClaudeAgentPreToolUseHook', () => {
  it.each<Options['permissionMode']>(['default', 'bypassPermissions'])(
    'denies ExitPlanMode in %s mode',
    async (permissionMode) => {
      const result = await invokePreToolUseHook(
        createHook(permissionMode),
        createPreToolUseInput('ExitPlanMode'),
      )

      expect(result).toEqual({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE,
        },
      })
    },
  )

  it('passes through ordinary tools without a hook decision', async () => {
    await expect(
      invokePreToolUseHook(createHook('default'), createPreToolUseInput('Read')),
    ).resolves.toEqual({ continue: true })
  })

  it('denies AskUserQuestion when its transport is unavailable in bypass mode', async () => {
    await expect(
      invokePreToolUseHook(
        createHook('bypassPermissions'),
        createPreToolUseInput('AskUserQuestion'),
      ),
    ).resolves.toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: ASK_USER_QUESTION_BYPASS_DENIAL,
      },
    })
  })

  it.each<Options['permissionMode']>(['default', 'plan'])(
    'leaves AskUserQuestion to canUseTool in %s mode',
    async (permissionMode) => {
      await expect(
        invokePreToolUseHook(
          createHook(permissionMode),
          createPreToolUseInput('AskUserQuestion'),
        ),
      ).resolves.toEqual({ continue: true })
    },
  )
})

describe('createClaudeAgentPreModelSwitchHook', () => {
  it('allows a switch without prompting when no warm cache cost is at risk', async () => {
    const requestToolApproval = vi.fn()
    const hook = createClaudeAgentPreModelSwitchHook({
      deps: { readSecret: () => '', requestToolApproval },
      state: createClaudeAgentPermissionBridgeState({
        runtimeInput: createStreamTurnInput(),
        permissionMode: 'default',
        runtimeSettings: null,
      }),
    })

    await expect(invokePreModelSwitchHook(hook, createPreModelSwitchInput({
      prompt_cache_warm: false,
      estimated_cache_write_usd: 0.25,
    }))).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: 'allow' },
    })
    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('bridges a warm-cache switch through Cradle approval with exact cost facts', async () => {
    const requestToolApproval = vi.fn().mockResolvedValue({
      requestId: 'approval-1',
      approved: true,
    })
    const hook = createClaudeAgentPreModelSwitchHook({
      deps: { readSecret: () => '', requestToolApproval },
      state: createClaudeAgentPermissionBridgeState({
        runtimeInput: createStreamTurnInput(),
        permissionMode: 'default',
        runtimeSettings: null,
      }),
    })

    await expect(invokePreModelSwitchHook(hook, createPreModelSwitchInput())).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: 'allow' },
    })
    expect(requestToolApproval).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'chat-session-1',
      runId: 'run-1',
      providerMethod: 'PreModelSwitch',
      metadata: {
        toolName: 'ModelSwitch',
        modelSwitch: expect.objectContaining({
          fromModelId: 'claude-sonnet-4-6',
          toModelId: 'claude-opus-4-6',
          promptCacheWarm: true,
          cacheTtl: '1h',
          contextTokens: 42_000,
          estimatedCacheWriteUsd: 0.25,
          pricing: 'configured',
        }),
      },
    }))
  })
})

function createHook(permissionMode: Options['permissionMode']): HookCallback {
  return createClaudeAgentPreToolUseHook({
    state: createClaudeAgentPermissionBridgeState({
      runtimeInput: createCapabilitiesInput(),
      permissionMode,
      runtimeSettings: { permissionMode: permissionMode ?? 'default' },
    }),
  })
}

function createCapabilitiesInput(): GetCapabilitiesInput {
  return {
    runtimeSession: {
      id: 'runtime-session-1',
      chatSessionId: 'chat-session-1',
      providerTargetId: null,
      runtimeKind: 'claude-agent',
      providerSessionId: null,
      providerStateSnapshot: null,
    },
    profile: null,
    workspacePath: '/tmp/cradle-workspace',
  }
}

function createStreamTurnInput(): StreamTurnInput {
  return {
    ...createCapabilitiesInput(),
    profile: {
      id: 'profile-1',
      name: 'Claude',
      providerKind: 'universal',
      enabled: true,
      configJson: '{}',
      credentialRef: null,
      customModels: '[]',
      iconSlug: null,
      providerTargetKind: 'manual',
      providerTargetId: 'profile-1',
    },
    runId: 'run-1',
    message: { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    history: [],
    modelId: null,
    systemPrompt: undefined,
    providerOptions: {},
  } as unknown as StreamTurnInput
}

function createPreModelSwitchInput(
  overrides: Partial<PreModelSwitchHookInput> = {},
): PreModelSwitchHookInput {
  return {
    hook_event_name: 'PreModelSwitch',
    session_id: 'claude-session-1',
    transcript_path: '/tmp/claude-session-1.jsonl',
    cwd: '/tmp/cradle-workspace',
    from_model: 'claude-sonnet-4-6',
    to_model: 'claude-opus-4-6',
    requested_model: 'opus',
    source: 'sdk',
    context_tokens: 42_000,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 0.25,
    pricing: 'configured',
    ...overrides,
  }
}

function createPreToolUseInput(toolName: string): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'claude-session-1',
    transcript_path: '/tmp/claude-session-1.jsonl',
    cwd: '/tmp/cradle-workspace',
    tool_name: toolName,
    tool_input: {},
    tool_use_id: `toolu_${toolName}`,
  }
}

function invokePreToolUseHook(
  hook: HookCallback,
  input: PreToolUseHookInput,
) {
  return hook(input, input.tool_use_id, { signal: new AbortController().signal })
}

function invokePreModelSwitchHook(
  hook: HookCallback,
  input: PreModelSwitchHookInput,
) {
  return hook(input, undefined, { signal: new AbortController().signal })
}
