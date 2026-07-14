import type { UIMessage } from 'ai'

import type { ChatPluginContextPart, ChatSkillContextPart } from '../../chat-runtime/context-parts'
import {
  readChatFileLineCommentContextPart,
  readChatPluginContextPart,
  readChatSkillContextPart,
} from '../../chat-runtime/context-parts'

export type RuntimeMessageInput = UIMessage | string

type MessagePart = UIMessage['parts'][number]
type TextMessagePart = Extract<MessagePart, { type: 'text' }>
type FileMessagePart = Extract<MessagePart, { type: 'file' }>

export type ProviderInputPart
  = | { type: 'text', text: string, part?: TextMessagePart }
    | { type: 'file', mediaType: string, url: string, filename?: string, part: FileMessagePart }
    | { type: 'skill', skill: ChatSkillContextPart, part: MessagePart }
    | { type: 'plugin', plugin: ChatPluginContextPart, part: MessagePart }
    | { type: 'unsupported', partType: string, part: MessagePart }

export function projectProviderInputParts(message: RuntimeMessageInput): ProviderInputPart[] {
  if (typeof message === 'string') {
    return [{ type: 'text', text: message }]
  }

  return message.parts.map((part): ProviderInputPart => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text, part }
    }
    if (part.type === 'file') {
      return {
        type: 'file',
        mediaType: part.mediaType,
        url: part.url,
        ...(part.filename ? { filename: part.filename } : {}),
        part,
      }
    }
    const skillPart = readChatSkillContextPart(part)
    if (skillPart) {
      return { type: 'skill', skill: skillPart, part }
    }
    const pluginPart = readChatPluginContextPart(part)
    if (pluginPart) {
      return { type: 'plugin', plugin: pluginPart, part }
    }
    const fileLineComment = readChatFileLineCommentContextPart(part)
    if (fileLineComment) {
      const lineLabel = fileLineComment.lineStart === fileLineComment.lineEnd
        ? `L${fileLineComment.lineStart}`
        : `L${fileLineComment.lineStart}-L${fileLineComment.lineEnd}`
      return {
        type: 'text',
        text: [
          `<file_line_comment path=${JSON.stringify(fileLineComment.path)} lines=${JSON.stringify(lineLabel)}>`,
          fileLineComment.comment,
          '</file_line_comment>',
        ].join('\n'),
      }
    }
    return { type: 'unsupported', partType: part.type, part }
  })
}

export function extractProviderInputText(message: RuntimeMessageInput): string {
  return projectProviderInputParts(message)
    .filter((part): part is Extract<ProviderInputPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

export function projectTextOnlyInput(message: RuntimeMessageInput, runtimeLabel: string): string {
  const parts = projectProviderInputParts(message)
  const unsupportedParts = parts.filter(part => part.type !== 'text')
  if (unsupportedParts.length > 0) {
    const details = unsupportedParts.map(describeProviderInputPart).join(', ')
    throw new Error(`${runtimeLabel} only supports text input; unsupported parts: ${details}`)
  }

  const text = parts
    .map(part => part.type === 'text' ? part.text : '')
    .join('\n')
    .trim()
  if (!text) {
    throw new Error(`${runtimeLabel} requires non-empty text input`)
  }
  return text
}

export function describeProviderInputPart(part: ProviderInputPart): string {
  switch (part.type) {
    case 'text':
      return 'text'
    case 'file': {
      const filename = part.filename ? ` (${part.filename})` : ''
      return `file${filename} (${part.mediaType})`
    }
    case 'skill':
      return `skill ${part.skill.name}`
    case 'plugin':
      return `plugin ${part.plugin.displayName || part.plugin.pluginName}`
    case 'unsupported':
      return part.partType
  }
}
