import type { Permission, ToolPart } from '@opencode-ai/sdk'

import type { CradleToolKind } from '../../../chat-runtime/runtime-provider-types'
import { isCradleWriteArtifactToolName } from '../../tools/artifact-tool'
import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import { readOpencodeTaskChildSessionId } from '../subagent-bridge'
import { OpencodeToolIdentifier } from './identity'

const OPENCODE_TOOL_KINDS: Record<string, CradleToolKind> = {
  bash: 'terminal',
  read: 'file-read',
  write: 'file-diff',
  edit: 'file-diff',
  patch: 'file-diff',
  glob: 'search',
  grep: 'search',
  list: 'search',
  webfetch: 'web',
  websearch: 'web',
  task: 'subagent',
  todo: 'todo',
  todowrite: 'todo',
  todoread: 'todo',
  plan: 'plan',
  question: 'question',
}

const OPENCODE_MCP_TOOL_NAME_PATTERN = /^mcp[_:]/i

/**
 * Classifies an OpenCode tool call into Cradle's canonical vocabulary. Built-in OpenCode
 * tools use stable lowercase names; MCP tools are prefixed with `mcp_` or `mcp:`.
 */
export function classifyOpencodeToolKind(apiName: string): CradleToolKind {
  if (isCradleWriteArtifactToolName(apiName)) {
    return 'artifact'
  }
  if (OPENCODE_MCP_TOOL_NAME_PATTERN.test(apiName)) {
    return 'mcp'
  }
  return OPENCODE_TOOL_KINDS[apiName.toLowerCase()] ?? 'generic'
}

export function buildOpencodeToolInput(part: ToolPart) {
  const kind = classifyOpencodeToolKind(part.tool)
  const args = projectToolArgs(part)
  return createBuiltinToolCallInputPayload({
    identifier: OpencodeToolIdentifier,
    apiName: part.tool,
    kind,
    args: kind === 'subagent' ? enrichOpencodeTaskSubagentArgs(part, args) : args,
  })
}

export function buildOpencodeToolOutput(part: ToolPart) {
  const kind = classifyOpencodeToolKind(part.tool)
  const result = projectToolResult(part)
  const args = projectToolArgs(part)
  return createBuiltinToolCallResultPayload({
    identifier: OpencodeToolIdentifier,
    apiName: part.tool,
    kind,
    args,
    result: kind === 'subagent' ? enrichOpencodeTaskSubagentResult(part, result) : result,
  })
}

export function buildOpencodePermissionInput(permission: Permission) {
  return createBuiltinToolCallInputPayload({
    identifier: OpencodeToolIdentifier,
    apiName: 'approval.permissions',
    kind: classifyOpencodeToolKind(permission.type),
    args: {
      id: permission.id,
      type: permission.type,
      title: permission.title,
      pattern: permission.pattern,
      sessionID: permission.sessionID,
      messageID: permission.messageID,
      callID: permission.callID ?? null,
      metadata: permission.metadata,
      createdAt: permission.time.created,
    },
  })
}

export function buildOpencodePermissionOutput(input: {
  permission: Permission
  response: 'once' | 'always' | 'reject'
  approved: boolean
  reason?: string
}) {
  return createBuiltinToolCallResultPayload({
    identifier: OpencodeToolIdentifier,
    apiName: 'approval.permissions',
    kind: classifyOpencodeToolKind(input.permission.type),
    args: {
      id: input.permission.id,
      type: input.permission.type,
      title: input.permission.title,
      pattern: input.permission.pattern,
      metadata: input.permission.metadata,
    },
    result: {
      response: input.response,
      approved: input.approved,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  })
}

function projectToolResult(part: ToolPart): unknown {
  switch (part.state.status) {
    case 'completed':
      return {
        title: part.state.title,
        output: part.state.output,
        metadata: part.state.metadata,
        attachments: part.state.attachments ?? [],
      }
    case 'error':
      return {
        error: part.state.error,
        metadata: part.state.metadata ?? {},
      }
    case 'running':
      return {
        title: part.state.title ?? part.tool,
        metadata: part.state.metadata ?? {},
      }
    case 'pending':
      return {
        raw: part.state.raw,
      }
  }
}

function projectToolArgs(part: ToolPart): Record<string, unknown> {
  const input = readToolStateInput(part)
  const metadata = part.state.status === 'running' || part.state.status === 'completed' || part.state.status === 'error'
    ? part.state.metadata ?? {}
    : {}
  const args = input && typeof input === 'object' && !Array.isArray(input)
    ? { ...input }
    : input === undefined || input === null || input === ''
      ? {}
      : { input }
  return {
    ...args,
    ...readCommonMetadataArgs(metadata),
  }
}

function readToolStateInput(part: ToolPart): unknown {
  if (part.state.status !== 'pending') {
    return part.state.input
  }
  if (part.state.input && Object.keys(part.state.input).length > 0) {
    return part.state.input
  }
  return parseRawToolInput(part.state.raw)
}

function parseRawToolInput(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  try {
    return JSON.parse(trimmed)
  }
  catch {
    return { raw: trimmed }
  }
}

function readCommonMetadataArgs(metadata: Record<string, unknown>): Record<string, unknown> {
  const path = readStringValue(metadata, 'path') ?? readStringValue(metadata, 'filePath') ?? readStringValue(metadata, 'filepath')
  const command = readStringValue(metadata, 'command') ?? readStringValue(metadata, 'cmd')
  const workdir = readStringValue(metadata, 'workdir') ?? readStringValue(metadata, 'cwd')
  return {
    ...(path ? { path, filePath: path } : {}),
    ...(command ? { command } : {}),
    ...(workdir ? { workdir } : {}),
  }
}

function readStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function enrichOpencodeTaskSubagentArgs(part: ToolPart, projectedArgs?: unknown): unknown {
  const input = projectedArgs ?? readToolStateInput(part)
  if (!input || typeof input !== 'object') {
    return input
  }
  const description = 'description' in input && typeof input.description === 'string' ? input.description : null
  const subagentType = 'subagent_type' in input && typeof input.subagent_type === 'string'
    ? input.subagent_type
    : 'subagentType' in input && typeof input.subagentType === 'string'
      ? input.subagentType
      : null
  return {
    ...input,
    ...(description ? { subagentName: description } : {}),
    ...(subagentType ? { agentType: subagentType, subagent_type: subagentType } : {}),
  }
}

function enrichOpencodeTaskSubagentResult(part: ToolPart, result: unknown): unknown {
  const childSessionId = readOpencodeTaskChildSessionId(part)
  const input = projectToolArgs(part)
  const enrichedArgs = enrichOpencodeTaskSubagentArgs(part, input)
  const base = result && typeof result === 'object' ? result as Record<string, unknown> : { result }
  const description = enrichedArgs && typeof enrichedArgs === 'object' && 'subagentName' in enrichedArgs
    ? enrichedArgs.subagentName
    : null
  const subagentType = enrichedArgs && typeof enrichedArgs === 'object' && 'agentType' in enrichedArgs
    ? enrichedArgs.agentType
    : null
  return {
    ...base,
    ...(typeof description === 'string' ? { subagentName: description } : {}),
    ...(typeof subagentType === 'string' ? { agentType: subagentType, subagent_type: subagentType } : {}),
    ...(childSessionId ? { threadId: childSessionId, sessionId: childSessionId } : {}),
    ...(input && typeof input === 'object' ? { input } : {}),
  }
}
