import type {
  HookCallback,
  Options,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import type { GetCapabilitiesInput } from '../../chat-runtime/runtime-provider-types'
import {
  createClaudeAgentPermissionBridgeState,
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
