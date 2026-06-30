import type { UIMessage } from 'ai'

import type { ContentItem as CodexContentItem } from '../app-server-protocol/ContentItem'
import type { ResponseItem as CodexResponseItem } from '../app-server-protocol/ResponseItem'

type MessagePart = UIMessage['parts'][number]

export function projectCradleTranscriptToCodexItems(messages: UIMessage[]): CodexResponseItem[] {
  const items: CodexResponseItem[] = []
  for (const message of messages) {
    items.push(...projectMessage(message))
  }
  return items
}

function projectMessage(message: UIMessage): CodexResponseItem[] {
  const bangItems = projectBangMetadataMessage(message)
  if (bangItems) {
    return bangItems
  }

  const codexResponseItems = readCodexResponseItems(message)
  if (codexResponseItems) {
    return codexResponseItems
  }

  const items: CodexResponseItem[] = []
  let pendingContent: CodexContentItem[] = []

  const flushMessage = () => {
    if (pendingContent.length === 0) {
      return
    }
    items.push({
      type: 'message',
      role: message.role,
      content: pendingContent,
    })
    pendingContent = []
  }

  for (const part of message.parts) {
    const projectedContent = projectContentPart(message.role, part)
    if (projectedContent) {
      pendingContent.push(...projectedContent)
      continue
    }

    flushMessage()
    items.push(...projectNonContentPart(part))
  }

  flushMessage()
  if (items.length === 0) {
    items.push({
      type: 'message',
      role: message.role,
      content: [textContentForRole(message.role, '[Cradle transcript message contained no model-visible parts]')],
    })
  }
  return items
}

function projectBangMetadataMessage(message: UIMessage): CodexResponseItem[] | null {
  const cradleMetadata = asRecord(asRecord(message.metadata)?.cradle)
  if (!cradleMetadata) {
    return null
  }

  const bangResult = asRecord(cradleMetadata.bangResult)
  if (bangResult) {
    const command = typeof bangResult.command === 'string' ? bangResult.command.trim() : ''
    if (!command) {
      return []
    }
    const stdout = typeof bangResult.stdout === 'string' ? bangResult.stdout : ''
    const stderr = typeof bangResult.stderr === 'string' ? bangResult.stderr : ''
    const output = stdout || stderr
    const exitCode = typeof bangResult.exitCode === 'number' ? bangResult.exitCode : null
    const callId = `cradle-bang-${message.id}`
    return [
      {
        type: 'function_call',
        name: 'command_execution',
        arguments: stringifyForCodex({ command }),
        call_id: callId,
      },
      {
        type: 'function_call_output',
        call_id: callId,
        output: stringifyForCodex({
          command,
          output,
          stdout,
          stderr,
          exitCode,
          code: exitCode,
          durationMs: typeof bangResult.durationMs === 'number' ? bangResult.durationMs : 0,
          timedOut: bangResult.timedOut === true,
          truncated: bangResult.truncated === true,
        }),
      },
    ]
  }

  if (asRecord(cradleMetadata.bangCommand)) {
    return []
  }

  return null
}

function readCodexResponseItems(message: UIMessage): CodexResponseItem[] | null {
  const codexMetadata = asRecord(asRecord(message.metadata)?.codex)
  const responseItems = Array.isArray(codexMetadata?.responseItems)
    ? codexMetadata.responseItems
    : null
  if (!responseItems) {
    return null
  }

  const items: CodexResponseItem[] = []
  for (const responseItem of responseItems) {
    const item = asRecord(asRecord(responseItem)?.item)
    if (typeof item?.type === 'string') {
      items.push(item as CodexResponseItem)
    }
  }
  return items.length > 0 ? items : null
}

function projectContentPart(role: UIMessage['role'], part: MessagePart): CodexContentItem[] | null {
  const record = asRecord(part)
  if (!record) {
    return [textContentForRole(role, describeOpaquePart(part))]
  }

  if (part.type === 'text') {
    const text = typeof record.text === 'string' ? record.text : ''
    return text ? [textContentForRole(role, text)] : null
  }

  if (part.type === 'file') {
    return projectFilePart(role, record)
  }

  if (part.type === 'step-start' || record.type === 'step-finish') {
    return [textContentForRole(role, describeOpaquePart(part))]
  }

  if (isUnknownContentLikePart(record)) {
    return [textContentForRole(role, describeOpaquePart(part))]
  }

  return null
}

function projectNonContentPart(part: MessagePart): CodexResponseItem[] {
  const record = asRecord(part)
  if (!record) {
    return [otherItem(part)]
  }

  if (part.type === 'reasoning') {
    const text = readReasoningText(record)
    if (!text) {
      return [otherItem(part)]
    }
    return [{
      type: 'reasoning',
      summary: [{ type: 'summary_text', text }],
      content: [{ type: 'reasoning_text', text }],
      encrypted_content: null,
    }]
  }

  if (isToolPart(record)) {
    return projectToolPart(record)
  }

  return [otherItem(part)]
}

function projectFilePart(role: UIMessage['role'], part: Record<string, unknown>): CodexContentItem[] {
  const mediaType = typeof part.mediaType === 'string' ? part.mediaType : ''
  const url = typeof part.url === 'string' ? part.url : ''
  const filename = typeof part.filename === 'string' ? part.filename : null

  if (mediaType.startsWith('image/') && url) {
    return [{
      type: 'input_image',
      image_url: url,
      ...(readImageDetail(part) ? { detail: readImageDetail(part) } : {}),
    } as CodexContentItem]
  }

  return [textContentForRole(role, JSON.stringify({
    type: 'cradle.file',
    filename,
    mediaType,
    url,
  }))]
}

function projectToolPart(part: Record<string, unknown>): CodexResponseItem[] {
  const toolCallId = String(part.toolCallId)
  const toolInput = readBuiltinToolCallInputPayload(part.input)
  const toolOutput = readBuiltinToolCallResultPayload(part.output)
  const toolName = toolInput?.apiName ?? toolOutput?.apiName ?? readToolName(part)
  const items: CodexResponseItem[] = [{
    type: 'function_call',
    name: toolName,
    arguments: stringifyForCodex(toolInput?.args ?? toolOutput?.args ?? part.input ?? {}),
    call_id: toolCallId,
  }]

  if (part.state === 'output-available' || part.state === 'output-error' || part.state === 'output-denied') {
    items.push({
      type: 'function_call_output',
      call_id: toolCallId,
      output: stringifyForCodex(readToolOutput(part)),
    })
  }

  return items
}

function readToolOutput(part: Record<string, unknown>): unknown {
  const builtinResult = readBuiltinToolCallResultPayload(part.output)
  if (builtinResult) {
    return builtinResult.result
  }
  if (part.state === 'output-error') {
    return {
      error: typeof part.errorText === 'string' ? part.errorText : 'Tool call failed',
    }
  }
  if (part.state === 'output-denied') {
    return { denied: true }
  }
  return part.output ?? ''
}

function readBuiltinToolCallInputPayload(value: unknown): { apiName: string, args: unknown } | null {
  const record = asRecord(value)
  if (!record || record.type !== 'cradle.builtin-tool-call.input.v1') {
    return null
  }
  return typeof record.apiName === 'string'
    ? { apiName: record.apiName, args: record.args }
    : null
}

function readBuiltinToolCallResultPayload(value: unknown): { apiName: string, args?: unknown, result: unknown } | null {
  const record = asRecord(value)
  if (!record || record.type !== 'cradle.builtin-tool-call.result.v1') {
    return null
  }
  return typeof record.apiName === 'string'
    ? {
        apiName: record.apiName,
        ...(record.args === undefined ? {} : { args: record.args }),
        result: record.result,
      }
    : null
}

function readToolName(part: Record<string, unknown>): string {
  if (typeof part.toolName === 'string' && part.toolName) {
    return part.toolName
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length)
  }
  return 'unknown_tool'
}

function textContentForRole(role: UIMessage['role'], text: string): CodexContentItem {
  return role === 'assistant'
    ? { type: 'output_text', text }
    : { type: 'input_text', text }
}

function otherItem(value: unknown): CodexResponseItem {
  return {
    type: 'message',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: describeOpaquePart(value),
    }],
  }
}

function describeOpaquePart(value: unknown): string {
  return JSON.stringify({
    type: 'cradle.transcript_part',
    value,
  })
}

function stringifyForCodex(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
  catch {
    return JSON.stringify({ unserializable: true })
  }
}

function readReasoningText(part: Record<string, unknown>): string | null {
  if (typeof part.text === 'string' && part.text) {
    return part.text
  }
  if (typeof part.reasoning === 'string' && part.reasoning) {
    return part.reasoning
  }
  return null
}

function readImageDetail(part: Record<string, unknown>): 'high' | 'original' | null {
  return part.detail === 'high' || part.detail === 'original' ? part.detail : null
}

function isToolPart(part: Record<string, unknown>): boolean {
  return typeof part.toolCallId === 'string'
    && (part.type === 'dynamic-tool' || (typeof part.type === 'string' && part.type.startsWith('tool-')))
}

function isUnknownContentLikePart(part: Record<string, unknown>): boolean {
  return typeof part.type === 'string' && part.type.startsWith('data-')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
