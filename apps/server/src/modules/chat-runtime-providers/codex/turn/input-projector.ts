/**
 * Output: Codex app-server user input and provider-native command projections.
 * Input: Cradle UIMessage/string turns, file parts, and selected skill context parts.
 * Position: Codex provider package boundary from Chat Runtime input to app-server UserInput.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UIMessage } from 'ai'

import { readObjectRecord as readRecord } from '../../../../helpers/json-record'
import { readChatPluginContextPart, readChatSkillContextPart } from '../../../chat-runtime/context-parts'
import { readGoalMessageObjective } from '../../../chat-runtime/ui-message'
import { extractUiMessageText } from '../../../chat-runtime/ui-message-input'
import { codexRequestError } from '../provider-errors'

export type CodexRuntimeMessageInput = UIMessage | string
type MessagePart = UIMessage['parts'][number]

export type CodexUserInput = { type: 'text', text: string, text_elements: [] }
  | { type: 'image', detail?: 'high' | 'original', url: string }
  | { type: 'localImage', detail?: 'high' | 'original', path: string }
  | { type: 'skill', name: string, path: string }
  | { type: 'mention', name: string, path: string }

export function readCodexGoalCommandObjective(message: CodexRuntimeMessageInput): string | null {
  if (typeof message !== 'string') {
    const metadataObjective = readGoalMessageObjective(message)
    if (metadataObjective) {
      return metadataObjective
    }
  }
  const text = extractUiMessageText(message).trim()
  if (!text.startsWith('/goal')) {
    return null
  }
  const objective = text.slice('/goal'.length).trim()
  return objective.length > 0 ? objective : null
}

export function isCodexCompactCommand(message: CodexRuntimeMessageInput): boolean {
  const text = extractUiMessageText(message).trim()
  if (!text.startsWith('/compact')) {
    return false
  }
  const nextChar = text.charAt('/compact'.length)
  return !nextChar || nextChar === ' ' || nextChar === '\t'
}

export function projectCodexUserInput(message: CodexRuntimeMessageInput, runtimeLabel: string): CodexUserInput[] {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw codexRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
    }
    return [toTextUserInput(text)]
  }

  const input: CodexUserInput[] = []
  const unsupportedParts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (text) {
        input.push(toTextUserInput(text))
      }
      continue
    }
    if (part.type === 'file') {
      if (part.mediaType.startsWith('image/')) {
        input.push(toCodexImageInput(part))
        const accessibilityText = projectCradleAppshotAccessibilityText(part)
        if (accessibilityText) {
          input.push(toTextUserInput(accessibilityText))
        }
      }
      else {
        unsupportedParts.push(describeUnsupportedFilePart(part))
      }
      continue
    }
    const skillPart = readChatSkillContextPart(part)
    if (skillPart) {
      input.push({ type: 'skill', name: skillPart.name, path: resolveCodexSkillFilePath(skillPart.path) })
      continue
    }
    const pluginPart = readChatPluginContextPart(part)
    if (pluginPart) {
      if (pluginPart.provider === 'codex' && pluginPart.nativeMention) {
        input.push({
          type: 'mention',
          name: pluginPart.nativeMention.name,
          path: pluginPart.nativeMention.path,
        })
      }
      else {
        input.push(toTextUserInput(describeCradlePluginContext(pluginPart)))
      }
      continue
    }
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw codexRequestError('projectInput', `${runtimeLabel} only supports text, image, skill, and mention input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (input.length === 0) {
    throw codexRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
  }
  return input
}

export function describeCodexUserInput(input: CodexUserInput[], text: string): string {
  const imageCount = input.filter(item => item.type === 'image' || item.type === 'localImage').length
  const skillCount = input.filter(item => item.type === 'skill').length
  const mentionCount = input.filter(item => item.type === 'mention').length
  if (imageCount === 0 && skillCount === 0 && mentionCount === 0) {
    return text
  }
  const suffixParts = [
    imageCount > 0 ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : '',
    skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? '' : 's'}` : '',
    mentionCount > 0 ? `${mentionCount} mention${mentionCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  const suffix = `[${suffixParts.join(', ')}]`
  return text ? `${text}\n${suffix}` : suffix
}

function toTextUserInput(text: string): CodexUserInput {
  return { type: 'text', text, text_elements: [] }
}

function resolveCodexSkillFilePath(inputPath: string): string {
  const skillFilePath = join(inputPath, 'SKILL.md')
  return existsSync(skillFilePath) ? skillFilePath : inputPath
}

function describeCradlePluginContext(part: NonNullable<ReturnType<typeof readChatPluginContextPart>>): string {
  const labels = [
    `@${part.displayName || part.pluginName}`,
    `Cradle plugin: ${part.pluginName}`,
    part.routeSegment ? `route: ${part.routeSegment}` : '',
    part.mcpServers.length > 0 ? `MCP servers: ${part.mcpServers.join(', ')}` : '',
    part.capabilities.length > 0 ? `capabilities: ${part.capabilities.map(capability => capability.type).join(', ')}` : '',
  ].filter(Boolean)
  return labels.join('\n')
}

function toCodexImageInput(part: Extract<MessagePart, { type: 'file' }>): CodexUserInput {
  if (part.url.startsWith('file:')) {
    return { type: 'localImage', path: fileURLToPath(part.url) }
  }
  return { type: 'image', url: part.url }
}

function projectCradleAppshotAccessibilityText(part: Extract<MessagePart, { type: 'file' }>): string | null {
  const metadata = readRecord(part.providerMetadata)
  const cradle = readRecord(metadata.cradle)
  const appshot = readRecord(cradle.appshot)
  if (appshot.kind !== 'cradle-appshot') {
    return null
  }

  const axTree = readString(appshot.axTree)?.trim()
  if (!axTree) {
    return null
  }

  const appName = readString(appshot.appName)
  const windowTitle = readString(appshot.windowTitle)
  const bundleIdentifier = readString(appshot.bundleIdentifier)
  const context = [
    'Attached app screenshot accessibility tree (AXTree).',
    appName ? `App: ${appName}` : '',
    windowTitle ? `Window: ${windowTitle}` : '',
    bundleIdentifier ? `Bundle: ${bundleIdentifier}` : '',
  ].filter(Boolean)
  return `${context.join('\n')}\n\n${axTree}`
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function describeUnsupportedFilePart(part: Extract<MessagePart, { type: 'file' }>): string {
  const filename = part.filename ? ` (${part.filename})` : ''
  return `file${filename} (${part.mediaType})`
}
