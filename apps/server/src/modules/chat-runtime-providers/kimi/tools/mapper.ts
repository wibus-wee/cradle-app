import type { CradleToolKind } from '../../../chat-runtime/runtime-provider-types'
import { createBuiltinToolCallInputPayload, createBuiltinToolCallResultPayload } from '../../tools/tool-call-payload'

export const KIMI_TOOL_IDENTIFIER = 'kimi'

const KIMI_TOOL_KINDS: Record<string, CradleToolKind> = {
  Read: 'file-read',
Glob: 'search',
Grep: 'search',
Write: 'file-diff',
Edit: 'file-diff',
  Bash: 'terminal',
Terminal: 'terminal',
WebFetch: 'web',
WebSearch: 'web',
  Agent: 'subagent',
AgentSwarm: 'subagent',
Task: 'task-control',
TodoWrite: 'todo',
  TodoRead: 'todo',
Plan: 'plan',
AskUserQuestion: 'question',
}

export function classifyKimiToolKind(apiName: string): CradleToolKind {
  return apiName.startsWith('mcp__') ? 'mcp' : (KIMI_TOOL_KINDS[apiName] ?? 'generic')
}

export function buildKimiToolInput(apiName: string, args: unknown) {
  return createBuiltinToolCallInputPayload({
    identifier: KIMI_TOOL_IDENTIFIER,
    apiName,
    kind: classifyKimiToolKind(apiName),
    args,
  })
}

export function buildKimiToolOutput(apiName: string, args: unknown, result: unknown) {
  return createBuiltinToolCallResultPayload({
    identifier: KIMI_TOOL_IDENTIFIER,
    apiName,
    kind: classifyKimiToolKind(apiName),
    args,
    result,
  })
}
