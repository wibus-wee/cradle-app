import type { SkillScope } from '~/features/skills/types'

export interface ChatSkillContextPart {
  type: 'data-cradle-skill'
  name: string
  path: string
  scope: SkillScope
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

export interface ChatFileLineCommentContextPart {
  type: 'data-cradle-file-line-comment'
  workspaceId: string
  path: string
  lineStart: number
  lineEnd: number
  comment: string
  position?: number
}

export type ChatContextPart
  = | ChatSkillContextPart
    | ChatPluginContextPart
    | ChatFileLineCommentContextPart
export type ChatSkillContextMessagePart = {
  type: 'data-cradle-skill'
  data: ChatSkillContextPart
}
export type ChatPluginContextMessagePart = {
  type: 'data-cradle-plugin'
  data: ChatPluginContextPart
}
export type ChatFileLineCommentContextMessagePart = {
  type: 'data-cradle-file-line-comment'
  data: ChatFileLineCommentContextPart
}
export type ChatContextMessagePart
  = | ChatSkillContextMessagePart
    | ChatPluginContextMessagePart
    | ChatFileLineCommentContextMessagePart

function readSkillContextPayload(part: unknown): ChatSkillContextPart | null {
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

function readPluginContextPayload(part: unknown): ChatPluginContextPart | null {
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

export function isChatSkillContextPart(part: unknown): part is ChatSkillContextMessagePart {
  return readSkillContextPayload(part) !== null
}

export function isChatPluginContextPart(part: unknown): part is ChatPluginContextMessagePart {
  return readPluginContextPayload(part) !== null
}

export function isChatFileLineCommentContextPart(
  part: unknown,
): part is ChatFileLineCommentContextMessagePart {
  return readFileLineCommentPayload(part) !== null
}

export function readSkillContextPart(part: unknown): ChatSkillContextPart | null {
  return readSkillContextPayload(part)
}

export function readPluginContextPart(part: unknown): ChatPluginContextPart | null {
  return readPluginContextPayload(part)
}

export function readFileLineCommentContextPart(
  part: unknown,
): ChatFileLineCommentContextPart | null {
  return readFileLineCommentPayload(part)
}

function toMessageContextPart(part: ChatContextPart): ChatContextMessagePart {
  if (part.type === 'data-cradle-skill') {
    return { type: 'data-cradle-skill', data: part }
  }
  if (part.type === 'data-cradle-plugin') {
    return { type: 'data-cradle-plugin', data: part }
  }
  return { type: 'data-cradle-file-line-comment', data: part }
}

export function toMessageContextParts(parts: ChatContextPart[]): ChatContextMessagePart[] {
  return parts.map(toMessageContextPart)
}

export function toOrderedUserMessageParts(
  text: string,
  contextParts: ChatContextPart[],
  sourceText = text,
): ChatContextMessagePart[] | Array<ChatContextMessagePart | { type: 'text', text: string }> {
  if (contextParts.length === 0) {
    return text ? [{ type: 'text', text }] : []
  }

  const leadingTrim = sourceText.length - sourceText.trimStart().length
  const sortedParts = [...contextParts].sort(
    (left, right) => (left.position ?? sourceText.length) - (right.position ?? sourceText.length),
  )
  const parts: Array<ChatContextMessagePart | { type: 'text', text: string }> = []
  let offset = 0

  for (const contextPart of sortedParts) {
    const position
      = typeof contextPart.position === 'number'
        ? Math.max(0, Math.min(text.length, contextPart.position - leadingTrim))
        : text.length
    if (position > offset) {
      parts.push({ type: 'text', text: text.slice(offset, position) })
    }
    parts.push(toMessageContextPart(contextPart))
    offset = position
  }

  if (offset < text.length) {
    parts.push({ type: 'text', text: text.slice(offset) })
  }

  return parts
}

export function readSkillContextLabel(part: ChatSkillContextPart): string {
  return part.name
}

export function readPluginContextLabel(part: ChatPluginContextPart): string {
  return part.displayName || part.pluginName
}

export function readFileLineCommentContextLabel(part: ChatFileLineCommentContextPart): string {
  const lines
    = part.lineStart === part.lineEnd ? `L${part.lineStart}` : `L${part.lineStart}-L${part.lineEnd}`
  return `${part.path}:${lines}`
}
