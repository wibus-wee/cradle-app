import type { UIMessage } from 'ai'

const BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE = 'cradle.builtin-tool-call.input.v1'
const BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE = 'cradle.builtin-tool-call.result.v1'

type MessagePart = UIMessage['parts'][number]

export interface BuiltinToolCallIdentity {
  identifier: string
  apiName: string
}

export interface BuiltinToolCallInputPayload extends BuiltinToolCallIdentity {
  type: typeof BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE
  args: unknown
}

export interface BuiltinToolCallResultPayload extends BuiltinToolCallIdentity {
  type: typeof BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE
  args?: unknown
  result: unknown
}

export function isToolLikePart(part: MessagePart): part is MessagePart & {
  toolCallId: string
  toolName?: string
  state?: string
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  preliminary?: boolean
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
} {
  return (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
    && 'toolCallId' in part
    && typeof part.toolCallId === 'string'
}

export function toolNameFromPart(part: {
  type: string
  toolName?: string
}): string {
  return part.toolName ?? part.type
}

export function readBuiltinToolCallInputPayload(value: unknown): BuiltinToolCallInputPayload | null {
  if (!isRecord(value) || value.type !== BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE) {
    return null
  }
  if (typeof value.identifier !== 'string' || typeof value.apiName !== 'string') {
    return null
  }
  return {
    type: BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE,
    identifier: value.identifier,
    apiName: value.apiName,
    args: value.args,
  }
}

export function readBuiltinToolCallResultPayload(value: unknown): BuiltinToolCallResultPayload | null {
  if (!isRecord(value) || value.type !== BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE) {
    return null
  }
  if (typeof value.identifier !== 'string' || typeof value.apiName !== 'string') {
    return null
  }
  return {
    type: BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE,
    identifier: value.identifier,
    apiName: value.apiName,
    ...(value.args === undefined ? {} : { args: value.args }),
    result: value.result,
  }
}

export function readBuiltinToolCallIdentity(input: unknown, output: unknown): BuiltinToolCallIdentity | null {
  const inputPayload = readBuiltinToolCallInputPayload(input)
  if (inputPayload) {
    return {
      identifier: inputPayload.identifier,
      apiName: inputPayload.apiName,
    }
  }

  const resultPayload = readBuiltinToolCallResultPayload(output)
  if (resultPayload) {
    return {
      identifier: resultPayload.identifier,
      apiName: resultPayload.apiName,
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
