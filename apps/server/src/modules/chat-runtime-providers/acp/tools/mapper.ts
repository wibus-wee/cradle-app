import type { ToolCall, ToolCallUpdate, ToolKind } from '@agentclientprotocol/sdk'

import type { CradleToolKind } from '../../../chat-runtime/runtime-provider-types'
import type { RuntimeToolApprovalOption } from '../../tools/tool-call-payload'
import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import { AcpToolIdentifier } from './identity'

const ACP_TOOL_KINDS: Record<ToolKind, CradleToolKind> = {
  read: 'file-read',
  edit: 'file-diff',
  delete: 'file-diff',
  move: 'file-diff',
  search: 'search',
  execute: 'terminal',
  think: 'plan',
  fetch: 'web',
  switch_mode: 'task-control',
  other: 'generic',
}

export function classifyAcpToolKind(kind: ToolKind | null | undefined): CradleToolKind {
  return kind ? ACP_TOOL_KINDS[kind] : 'generic'
}

export function buildAcpToolInput(
  tool: ToolCall | ToolCallUpdate,
  title: string,
  approvalOptions?: RuntimeToolApprovalOption[],
) {
  return createBuiltinToolCallInputPayload({
    identifier: AcpToolIdentifier,
    apiName: tool.kind ?? 'other',
    kind: classifyAcpToolKind(tool.kind),
    args: {
      title,
      rawInput: tool.rawInput ?? null,
      locations: tool.locations ?? [],
      content: tool.content ?? [],
      _meta: tool._meta ?? null,
    },
    approvalOptions,
  })
}

export function buildAcpToolOutput(tool: ToolCall | ToolCallUpdate, title: string) {
  return createBuiltinToolCallResultPayload({
    identifier: AcpToolIdentifier,
    apiName: tool.kind ?? 'other',
    kind: classifyAcpToolKind(tool.kind),
    args: buildAcpToolInput(tool, title).args,
    result: {
      status: tool.status ?? null,
      rawOutput: tool.rawOutput ?? null,
      locations: tool.locations ?? [],
      content: tool.content ?? [],
      _meta: tool._meta ?? null,
    },
  })
}
