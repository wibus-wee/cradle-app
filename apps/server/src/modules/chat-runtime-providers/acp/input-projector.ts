import type { ContentBlock } from '@agentclientprotocol/sdk'

import type { RuntimeMessageInput } from '../kit/input-projector'
import { describeProviderInputPart, projectProviderInputParts } from '../kit/input-projector'

export function projectAcpPrompt(message: RuntimeMessageInput): ContentBlock[] {
  const blocks: ContentBlock[] = []

  for (const part of projectProviderInputParts(message)) {
    if (part.type === 'text') {
      if (part.text) {
        blocks.push({ type: 'text', text: part.text })
      }
      continue
    }

    if (part.type === 'file') {
      blocks.push(projectFilePart(part))
      continue
    }

    throw new Error(`ACP provider does not support ${describeProviderInputPart(part)} input`)
  }

  if (blocks.length === 0) {
    throw new Error('ACP provider requires non-empty input')
  }
  return blocks
}

function projectFilePart(part: {
  mediaType: string
  url: string
  filename?: string
}): ContentBlock {
  const data = readBase64DataUrl(part.url)
  if (data && part.mediaType.startsWith('image/')) {
    return { type: 'image', data: data.data, mimeType: data.mediaType, uri: part.url }
  }
  if (data && part.mediaType.startsWith('audio/')) {
    return { type: 'audio', data: data.data, mimeType: data.mediaType }
  }
  return {
    type: 'resource_link',
    uri: part.url,
    name: part.filename ?? fileNameFromUrl(part.url),
    mimeType: part.mediaType,
  }
}

function readBase64DataUrl(url: string): { mediaType: string, data: string } | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/is.exec(url)
  return match ? { mediaType: match[1]!, data: match[2]! } : null
}

function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('/').filter(Boolean).at(-1) ?? 'attachment'
  }
  catch {
    return 'attachment'
  }
}
