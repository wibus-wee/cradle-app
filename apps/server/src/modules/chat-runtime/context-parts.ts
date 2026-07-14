import type { UIMessage } from 'ai'

export type ChatContextPart
  = | ChatSkillContextPart
    | ChatPluginContextPart
    | ChatFileLineCommentContextPart

export interface ChatFileLineCommentContextPart {
  type: 'data-cradle-file-line-comment'
  workspaceId: string
  path: string
  lineStart: number
  lineEnd: number
  comment: string
  position?: number
}

export interface ChatSkillContextPart {
  type: 'data-cradle-skill'
  name: string
  path: string
  scope: 'builtin' | 'legacy' | 'global' | 'repository' | 'workspace' | 'agent'
  description: string | null
  position?: number
}

export interface ChatPluginMentionCapability {
  id: string
  type: string
  layer: 'server' | 'web' | 'desktop'
  label: string | null
}

export interface ChatPluginNativeMention {
  name: string
  path: string
}

export interface ChatPluginContextPart {
  type: 'data-cradle-plugin'
  provider?: 'cradle' | 'codex'
  pluginName: string
  displayName: string
  description: string | null
  iconUrl?: string | null
  routeSegment: string
  capabilities: ChatPluginMentionCapability[]
  mcpServers: string[]
  nativeMention?: ChatPluginNativeMention | null
  position?: number
}

type MessagePart = UIMessage['parts'][number]
type CradleSkillMessagePart = MessagePart & {
  type: 'data-cradle-skill'
  data: ChatSkillContextPart
}
type CradlePluginMessagePart = MessagePart & {
  type: 'data-cradle-plugin'
  data: ChatPluginContextPart
}
type CradleFileLineCommentMessagePart = MessagePart & {
  type: 'data-cradle-file-line-comment'
  data: ChatFileLineCommentContextPart
}
type CradleContextMessagePart
  = | CradleSkillMessagePart
    | CradlePluginMessagePart
    | CradleFileLineCommentMessagePart

function readSkillPayload(part: unknown): ChatSkillContextPart | null {
  if (!part || typeof part !== 'object') {
    return null
  }
  const record = part as { type?: unknown, data?: unknown }
  if (record.type !== 'data-cradle-skill') {
    return null
  }
  const data
    = record.data && typeof record.data === 'object'
      ? (record.data as {
          type?: unknown
          name?: unknown
          path?: unknown
          scope?: unknown
          description?: unknown
          position?: unknown
        })
      : null
  if (
    data?.type !== 'data-cradle-skill'
    || typeof data.name !== 'string'
    || typeof data.path !== 'string'
  ) {
    return null
  }
  return data as ChatSkillContextPart
}

function readPluginPayload(part: unknown): ChatPluginContextPart | null {
  if (!part || typeof part !== 'object') {
    return null
  }
  const record = part as { type?: unknown, data?: unknown }
  if (record.type !== 'data-cradle-plugin') {
    return null
  }
  const data
    = record.data && typeof record.data === 'object'
      ? (record.data as {
          type?: unknown
          pluginName?: unknown
          displayName?: unknown
          routeSegment?: unknown
          capabilities?: unknown
          mcpServers?: unknown
        })
      : null
  if (
    data?.type !== 'data-cradle-plugin'
    || typeof data.pluginName !== 'string'
    || typeof data.displayName !== 'string'
    || typeof data.routeSegment !== 'string'
    || !Array.isArray(data.capabilities)
    || !Array.isArray(data.mcpServers)
  ) {
    return null
  }
  const nativeMention = readPluginNativeMention(
    (record.data as { nativeMention?: unknown }).nativeMention,
  )
  return {
    ...(record.data as ChatPluginContextPart),
    provider: (record.data as { provider?: unknown }).provider === 'codex' ? 'codex' : 'cradle',
    nativeMention,
  }
}

function readFileLineCommentPayload(part: unknown): ChatFileLineCommentContextPart | null {
  if (!part || typeof part !== 'object') {
    return null
  }
  const record = part as { type?: unknown, data?: unknown }
  if (
    record.type !== 'data-cradle-file-line-comment'
    || !record.data
    || typeof record.data !== 'object'
  ) {
    return null
  }
  const data = record.data as Partial<ChatFileLineCommentContextPart>
  if (
    data.type !== 'data-cradle-file-line-comment'
    || typeof data.workspaceId !== 'string'
    || typeof data.path !== 'string'
    || typeof data.lineStart !== 'number'
    || typeof data.lineEnd !== 'number'
    || typeof data.comment !== 'string'
  ) {
    return null
  }
  return data as ChatFileLineCommentContextPart
}

function readPluginNativeMention(value: unknown): ChatPluginNativeMention | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as { name?: unknown, path?: unknown }
  if (typeof record.name !== 'string' || typeof record.path !== 'string') {
    return null
  }
  return {
    name: record.name,
    path: record.path,
  }
}

export function isChatSkillContextPart(
  part: MessagePart | unknown,
): part is CradleSkillMessagePart {
  return readSkillPayload(part) !== null
}

export function isChatPluginContextPart(
  part: MessagePart | unknown,
): part is CradlePluginMessagePart {
  return readPluginPayload(part) !== null
}

export function isChatContextPart(part: MessagePart | unknown): part is CradleContextMessagePart {
  return (
    isChatSkillContextPart(part)
    || isChatPluginContextPart(part)
    || readFileLineCommentPayload(part) !== null
  )
}

export function readChatSkillContextPart(part: MessagePart | unknown): ChatSkillContextPart | null {
  return readSkillPayload(part)
}

export function readChatPluginContextPart(
  part: MessagePart | unknown,
): ChatPluginContextPart | null {
  return readPluginPayload(part)
}

export function readChatFileLineCommentContextPart(
  part: MessagePart | unknown,
): ChatFileLineCommentContextPart | null {
  return readFileLineCommentPayload(part)
}

export function readChatContextPart(part: MessagePart | unknown): ChatContextPart | null {
  return (
    readChatSkillContextPart(part)
    ?? readChatPluginContextPart(part)
    ?? readChatFileLineCommentContextPart(part)
  )
}

export function toMessageParts(parts: ChatContextPart[] | undefined): MessagePart[] {
  return (parts ?? []).map(
    part =>
      ({
        type: part.type,
        data: part,
      }) as CradleContextMessagePart,
  )
}

export function toOrderedUserMessageParts(
  text: string,
  contextParts: ChatContextPart[] | undefined,
  sourceText = text,
): MessagePart[] {
  const parts = contextParts ?? []
  if (parts.length === 0) {
    return text ? [{ type: 'text', text } as MessagePart] : []
  }

  const leadingTrim = sourceText.length - sourceText.trimStart().length
  const sortedParts = [...parts].sort(
    (left, right) => (left.position ?? sourceText.length) - (right.position ?? sourceText.length),
  )
  const messageParts: MessagePart[] = []
  let offset = 0

  for (const contextPart of sortedParts) {
    const position
      = typeof contextPart.position === 'number'
        ? Math.max(0, Math.min(text.length, contextPart.position - leadingTrim))
        : text.length
    if (position > offset) {
      messageParts.push({ type: 'text', text: text.slice(offset, position) } as MessagePart)
    }
    messageParts.push({
      type: contextPart.type,
      data: contextPart,
    } as CradleContextMessagePart)
    offset = position
  }

  if (offset < text.length) {
    messageParts.push({ type: 'text', text: text.slice(offset) } as MessagePart)
  }

  return messageParts
}

export function describeChatContextPart(part: ChatContextPart): string {
  if (part.type === 'data-cradle-skill') {
    return `skill ${part.name}`
  }
  if (part.type === 'data-cradle-plugin') {
    return `plugin ${part.displayName}`
  }
  if (part.type === 'data-cradle-file-line-comment') {
    return `file comment ${part.path}:${part.lineStart}-${part.lineEnd}: ${part.comment}`
  }
  return 'context'
}
