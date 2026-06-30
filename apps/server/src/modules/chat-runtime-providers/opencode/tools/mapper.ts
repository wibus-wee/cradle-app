/**
 * Output: Cradle-owned builtin tool payloads projected from opencode-native tool parts.
 * Input: opencode tool part state.
 * Position: opencode provider package tool envelope mapper.
 */

import type { ToolPart } from '@opencode-ai/sdk'

import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import { OpencodeToolIdentifier } from './identity'

export function buildOpencodeToolInput(part: ToolPart) {
  return createBuiltinToolCallInputPayload({
    identifier: OpencodeToolIdentifier,
    apiName: part.tool,
    args: part.state.input,
  })
}

export function buildOpencodeToolOutput(part: ToolPart) {
  return createBuiltinToolCallResultPayload({
    identifier: OpencodeToolIdentifier,
    apiName: part.tool,
    args: part.state.input,
    result: projectToolResult(part),
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
