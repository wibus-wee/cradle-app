import type { types as SlackTypes } from '@slack/bolt'
import {
  markdownToBlocks,
  splitBlocksWithText,
} from 'markdown-to-slack-blocks'

const UNDERSCORE_PLACEHOLDER_OPEN = '\uE000'
const UNDERSCORE_PLACEHOLDER_CLOSE = '\uE001'

interface ProtectedSpans {
  text: string
  restore: (value: string) => string
}

export interface SlackBlockMessage {
  text: string
  blocks: Array<SlackTypes.KnownBlock | SlackTypes.Block>
}

function protectSpans(input: string, pattern: RegExp, tag: string): ProtectedSpans {
  const spans: string[] = []
  const text = input.replace(pattern, (match) => {
    const index = spans.length
    spans.push(match)
    return `${UNDERSCORE_PLACEHOLDER_OPEN}${tag}${index}${UNDERSCORE_PLACEHOLDER_CLOSE}`
  })
  return {
    text,
    restore(value: string): string {
      return value.replace(
        new RegExp(`${UNDERSCORE_PLACEHOLDER_OPEN}${tag}(\\d+)${UNDERSCORE_PLACEHOLDER_CLOSE}`, 'g'),
        (_, index: string) => spans[Number(index)] ?? '',
      )
    },
  }
}

export function normalizeUnderscoreEmphasis(input: string): string {
  if (!input.includes('_')) {
    return input
  }

  const fenced = protectSpans(input, /```[\s\S]*?```/g, 'F')
  const inline = protectSpans(fenced.text, /`[^`\n]+`/g, 'C')
  let text = inline.text
  text = text.replace(/(^|\W)__(?=\S)([\s\S]*?\S)__(\W|$)/g, '$1**$2**$3')
  text = text.replace(/(^|\W)_(?=\S)([\s\S]*?\S)_(\W|$)/g, '$1*$2*$3')
  return fenced.restore(inline.restore(text))
}

export function renderMarkdownForSlack(input: string): SlackBlockMessage[] {
  const normalized = normalizeUnderscoreEmphasis(input.trim() || '(No response text.)')
  const blocks = markdownToBlocks(normalized, { preferSectionBlocks: false })
  return splitBlocksWithText(blocks).map(batch => ({
    text: batch.text || normalized,
    blocks: batch.blocks as SlackBlockMessage['blocks'],
  }))
}

export function stripBotMention(text: string, botUserId?: string | null): string {
  let cleaned = text
  if (botUserId) {
    cleaned = cleaned.replace(new RegExp(`<@${botUserId}>`, 'g'), '')
  }
  return cleaned.trim()
}

export function buildSlackProvenanceText(input: {
  slackUserId: string | null
  channelId: string
  text: string
}): string {
  void input.slackUserId
  void input.channelId
  return input.text
}

export function titleFromSlackText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const suffix = compact.length > 60 ? `${compact.slice(0, 57)}...` : compact
  return `Slack: ${suffix || 'Untitled thread'}`
}
