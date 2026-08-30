import { fileURLToPath } from 'node:url'

import type { StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import type { ProviderInputPart } from '../kit/input-projector'
import { projectProviderInputParts } from '../kit/input-projector'
import type { SubmitPromptData } from './protocol/rest/types.gen'

type KimiPromptBody = SubmitPromptData['body']
type KimiPromptContent = KimiPromptBody['content'][number]
type ProviderFileInputPart = Extract<ProviderInputPart, { type: 'file' }>
type ProviderPluginInputPart = Extract<ProviderInputPart, { type: 'plugin' }>

export interface KimiPromptProjection {
  content: KimiPromptBody['content']
  skills?: NonNullable<KimiPromptBody['skills']>
}

export function projectKimiPrompt(
  message: StreamTurnInput['message'],
): KimiPromptProjection {
  const content: KimiPromptContent[] = []
  const skills: NonNullable<KimiPromptBody['skills']> = []
  const unsupportedParts: string[] = []

  for (const part of projectProviderInputParts(message)) {
    switch (part.type) {
      case 'text': {
        if (part.text.trim()) {
          content.push({ type: 'text', text: part.text })
        }
        break
      }
      case 'file':
        content.push(projectKimiFilePart(part))
        break
      case 'skill':
        if (!skills.some(skill => skill.name === part.skill.name)) {
          skills.push({ name: part.skill.name })
        }
        break
      case 'plugin':
        content.push({ type: 'text', text: describeCradlePluginContext(part.plugin) })
        break
      case 'unsupported':
        unsupportedParts.push(part.partType)
        break
    }
  }

  if (unsupportedParts.length > 0) {
    throw new Error(`Kimi provider does not support input parts: ${unsupportedParts.join(', ')}`)
  }
  if (content.length === 0 && skills.length === 0) {
    throw new Error('Kimi provider requires non-empty text, attachment, or skill input')
  }

  return {
    content,
    ...(skills.length > 0 ? { skills } : {}),
  }
}

function projectKimiFilePart(part: ProviderFileInputPart): KimiPromptContent {
  const mediaKind = readKimiMediaKind(part.mediaType)
  const dataUrl = readBase64DataUrl(part.url)
  if (dataUrl) {
    if (!mediaKind) {
      throw unsupportedKimiFileError(part, 'base64 data URLs are only supported for image and video input')
    }
    return {
      type: mediaKind,
      source: {
        kind: 'base64',
        media_type: dataUrl.mediaType,
        data: dataUrl.data,
      },
    }
  }

  if (part.url.startsWith('http://') || part.url.startsWith('https://')) {
    if (!mediaKind) {
      throw unsupportedKimiFileError(part, 'remote URLs are only supported for image and video input')
    }
    return {
      type: mediaKind,
      source: { kind: 'url', url: part.url },
    }
  }

  const path = part.url.startsWith('file:') ? fileURLToPath(part.url) : part.url
  if (!path) {
    throw unsupportedKimiFileError(part, 'attachment path is empty')
  }
  if (mediaKind) {
    return {
      type: mediaKind,
      source: { kind: 'path', path },
    }
  }
  return {
    type: 'file',
    path,
    media_type: part.mediaType,
    ...(part.filename ? { name: part.filename } : {}),
  }
}

function readBase64DataUrl(url: string): { mediaType: string, data: string } | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/is.exec(url)
  return match ? { mediaType: match[1]!, data: match[2]! } : null
}

function readKimiMediaKind(mediaType: string): 'image' | 'video' | null {
  if (mediaType.startsWith('image/')) {
    return 'image'
  }
  if (mediaType.startsWith('video/')) {
    return 'video'
  }
  return null
}

function unsupportedKimiFileError(part: ProviderFileInputPart, detail: string): Error {
  const name = part.filename ? ` ${part.filename}` : ''
  return new Error(`Kimi provider cannot project${name} (${part.mediaType}): ${detail}`)
}

function describeCradlePluginContext(plugin: ProviderPluginInputPart['plugin']): string {
  return [
    `@${plugin.displayName || plugin.pluginName}`,
    `Cradle plugin: ${plugin.pluginName}`,
    plugin.routeSegment ? `route: ${plugin.routeSegment}` : '',
    plugin.mcpServers.length > 0 ? `MCP servers: ${plugin.mcpServers.join(', ')}` : '',
    plugin.capabilities.length > 0
      ? `capabilities: ${plugin.capabilities.map(capability => capability.type).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')
}
