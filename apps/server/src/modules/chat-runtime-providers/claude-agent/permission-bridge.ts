/**
 * Output: Claude Agent SDK permission callback decisions.
 * Input: SDK tool permission requests and Cradle runtime pending-input hooks.
 * Position: Provider-owned bridge between SDK canUseTool and Chat Runtime semantics.
 */

import type { CanUseTool, Options, PermissionResult } from '@anthropic-ai/claude-agent-sdk'

import type { ChatRuntimeSettings, GetCapabilitiesInput, ProviderContext, StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import { requireRuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'
import { requestProviderToolApproval } from '../kit/permission-bridge'
import { CLAUDE_AGENT_RUNTIME_KIND } from './metadata'
import { CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE, isClaudeAgentExitPlanModeToolName } from './plan-mode'
import {
  buildClaudeAgentAskUserQuestionOutput,
  CLAUDE_AGENT_ASK_USER_QUESTION_METHOD,
  projectClaudeAgentUserInputQuestions,
  readClaudeAgentAskUserQuestionInput,
} from './user-question'

type ClaudeAgentCanUseToolOptions = Parameters<CanUseTool>[2]

export interface ClaudeAgentToolApprovalRequest {
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
  agentId: string | null
}

export interface ClaudeAgentPermissionBridgeState {
  runtimeInput: StreamTurnInput | GetCapabilitiesInput
  permissionMode: Options['permissionMode']
  runtimeSettings: ChatRuntimeSettings | null | undefined
}

export function createClaudeAgentPermissionBridgeState(input: ClaudeAgentPermissionBridgeState): ClaudeAgentPermissionBridgeState {
  return { ...input }
}

export function updateClaudeAgentPermissionBridgeState(
  state: ClaudeAgentPermissionBridgeState,
  input: ClaudeAgentPermissionBridgeState,
): void {
  state.runtimeInput = input.runtimeInput
  state.permissionMode = input.permissionMode
  state.runtimeSettings = input.runtimeSettings
}

export function createClaudeAgentCanUseTool(input: {
  deps: ProviderContext
  state: ClaudeAgentPermissionBridgeState
  emitToolApprovalRequest?: (request: ClaudeAgentToolApprovalRequest) => void
}): CanUseTool {
  return async (toolName, toolInput, options) => {
    if (toolName === 'AskUserQuestion' && input.deps.requestUserInput) {
      return handleAskUserQuestionViaCanUseTool({
        deps: input.deps,
        runtimeInput: input.state.runtimeInput,
        toolInput,
        options,
      })
    }

    if (isClaudeAgentExitPlanModeToolName(toolName)) {
      return denyClaudeAgentExitPlanMode()
    }

    return handleClaudeAgentToolPermissionRequest({
      deps: input.deps,
      runtimeInput: input.state.runtimeInput,
      permissionMode: input.state.permissionMode,
      runtimeSettings: input.state.runtimeSettings,
      toolName,
      toolInput,
      options,
      emitToolApprovalRequest: input.emitToolApprovalRequest,
    })
  }
}

function allowClaudeAgentTool(toolInput: Record<string, unknown>): PermissionResult {
  return {
    behavior: 'allow',
    updatedInput: toolInput,
  }
}

function denyClaudeAgentExitPlanMode(): PermissionResult {
  return {
    behavior: 'deny',
    message: CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE,
  }
}

async function handleAskUserQuestionViaCanUseTool(input: {
  deps: ProviderContext
  runtimeInput: StreamTurnInput | GetCapabilitiesInput
  toolInput: Record<string, unknown>
  options: ClaudeAgentCanUseToolOptions
}): Promise<PermissionResult> {
  const questionInput = readClaudeAgentAskUserQuestionInput(input.toolInput)
  if (!questionInput) {
    return {
      behavior: 'deny',
      message: 'Invalid AskUserQuestion input.',
    }
  }

  const sessionId = input.runtimeInput.runtimeSession.chatSessionId
  const runId = 'runId' in input.runtimeInput ? input.runtimeInput.runId : ''
  const resolution = await input.deps.requestUserInput!({
    sessionId,
    runId,
    providerRequestId: input.options.toolUseID,
    providerKind: requireRuntimeProviderTargetProfile(input.runtimeInput.profile, CLAUDE_AGENT_RUNTIME_KIND).providerKind,
    runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
    providerMethod: CLAUDE_AGENT_ASK_USER_QUESTION_METHOD,
    toolCallId: input.options.toolUseID,
    questions: projectClaudeAgentUserInputQuestions(questionInput),
    metadata: {
      params: questionInput,
    },
  })

  const output = buildClaudeAgentAskUserQuestionOutput({
    request: questionInput,
    answers: resolution.answers,
  })

  return {
    behavior: 'allow',
    updatedInput: {
      questions: output.questions,
      answers: output.answers,
      ...(output.annotations ? { annotations: output.annotations } : {}),
    },
  }
}

async function handleClaudeAgentToolPermissionRequest(input: {
  deps: ProviderContext
  runtimeInput: StreamTurnInput | GetCapabilitiesInput
  permissionMode: Options['permissionMode']
  runtimeSettings: ChatRuntimeSettings | null | undefined
  toolName: string
  toolInput: Record<string, unknown>
  options: ClaudeAgentCanUseToolOptions
  emitToolApprovalRequest?: (request: ClaudeAgentToolApprovalRequest) => void
}): Promise<PermissionResult> {
  if (input.permissionMode === 'bypassPermissions') {
    return allowClaudeAgentTool(input.toolInput)
  }

  if (input.runtimeSettings?.interactionMode === 'plan') {
    return {
      behavior: 'deny',
      message: 'Cradle is in plan mode. Submit or revise the plan before running implementation tools.',
    }
  }

  if (!input.deps.requestToolApproval || !('runId' in input.runtimeInput)) {
    return {
      behavior: 'deny',
      message: 'Chat Runtime does not expose pending tool approval handling for this Claude Agent request.',
    }
  }

  input.emitToolApprovalRequest?.({
    toolCallId: input.options.toolUseID,
    toolName: input.toolName,
    toolInput: input.toolInput,
    agentId: readClaudeAgentPermissionAgentId(input.options),
  })

  const resolution = await requestProviderToolApproval({
    deps: input.deps,
    sessionId: input.runtimeInput.runtimeSession.chatSessionId,
    runId: input.runtimeInput.runId,
    providerRequestId: input.options.toolUseID,
    providerKind: requireRuntimeProviderTargetProfile(input.runtimeInput.profile, CLAUDE_AGENT_RUNTIME_KIND).providerKind,
    runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
    providerMethod: 'canUseTool',
    toolCallId: input.options.toolUseID,
    metadata: {
      toolName: input.toolName,
      params: input.toolInput,
      permission: {
        suggestions: input.options.suggestions,
        blockedPath: input.options.blockedPath,
        decisionReason: input.options.decisionReason,
        title: input.options.title,
        displayName: input.options.displayName,
        description: input.options.description,
        agentID: input.options.agentID,
      },
    },
  })

  if (resolution.approved) {
    return allowClaudeAgentTool(input.toolInput)
  }

  return {
    behavior: 'deny',
    message: resolution.reason ?? 'Tool execution denied by user.',
  }
}

function readClaudeAgentPermissionAgentId(options: ClaudeAgentCanUseToolOptions): string | null {
  const agentId = options.agentID
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : null
}
