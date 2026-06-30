import type { UIMessage } from 'ai'

const RE_CRADLE_CONTEXT_BLOCK = /<cradle_context>[\s\S]*?<\/cradle_context>/gi
const RE_OPEN_CRADLE_CONTEXT_BLOCK = /<cradle_context>[\s\S]*$/i
const RE_TRAILING_LINE_SPACES = /[ \t]+\n/g
const RE_REPEATED_BLANK_LINES = /\n{3,}/g

export function stripCradleContextForDisplay(text: string): string {
  const withoutClosedBlocks = text.replace(RE_CRADLE_CONTEXT_BLOCK, '')
  const withoutStreamingBlock = withoutClosedBlocks.replace(RE_OPEN_CRADLE_CONTEXT_BLOCK, '')

  if (withoutStreamingBlock === text) {
    return text
  }

  return withoutStreamingBlock
    .replace(RE_TRAILING_LINE_SPACES, '\n')
    .replace(RE_REPEATED_BLANK_LINES, '\n\n')
    .trim()
}

export function projectJarvisMessageForDisplay(message: UIMessage): UIMessage {
  let changed = false
  const parts = message.parts.map((part) => {
    if (part.type !== 'text') {
      return part
    }

    const text = stripCradleContextForDisplay(part.text)
    if (text === part.text) {
      return part
    }

    changed = true
    return { ...part, text }
  })

  if (!changed) {
    return message
  }

  return { ...message, parts }
}
