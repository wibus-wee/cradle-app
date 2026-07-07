import type { CradleToolKind } from '../../chat-runtime/runtime-provider-types'
import { cradleToolKinds } from '../../chat-runtime/runtime-provider-types'

export const BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE = 'cradle.builtin-tool-call.input.v1'
export const BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE = 'cradle.builtin-tool-call.result.v1'

export interface BuiltinToolCallInputPayload {
  type: typeof BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE
  identifier: string
  apiName: string
  kind: CradleToolKind
  args: unknown
}

export interface BuiltinToolCallResultPayload {
  type: typeof BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE
  identifier: string
  apiName: string
  kind: CradleToolKind
  args?: unknown
  result: unknown
}

export function createBuiltinToolCallInputPayload(input: {
  identifier: string
  apiName: string
  kind: CradleToolKind
  args: unknown
}): BuiltinToolCallInputPayload {
  return {
    type: BUILTIN_TOOL_CALL_INPUT_PAYLOAD_TYPE,
    identifier: input.identifier,
    apiName: input.apiName,
    kind: input.kind,
    args: input.args,
  }
}

export function createBuiltinToolCallResultPayload(input: {
  identifier: string
  apiName: string
  kind: CradleToolKind
  args?: unknown
  result: unknown
}): BuiltinToolCallResultPayload {
  return {
    type: BUILTIN_TOOL_CALL_RESULT_PAYLOAD_TYPE,
    identifier: input.identifier,
    apiName: input.apiName,
    kind: input.kind,
    ...(input.args === undefined ? {} : { args: input.args }),
    result: input.result,
  }
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
    kind: readCradleToolKind(value.kind),
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
    kind: readCradleToolKind(value.kind),
    ...(value.args === undefined ? {} : { args: value.args }),
    result: value.result,
  }
}

/** Defaults to `'generic'` for payloads persisted before `kind` existed. */
function readCradleToolKind(value: unknown): CradleToolKind {
  return typeof value === 'string' && (cradleToolKinds as readonly string[]).includes(value)
    ? (value as CradleToolKind)
    : 'generic'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
