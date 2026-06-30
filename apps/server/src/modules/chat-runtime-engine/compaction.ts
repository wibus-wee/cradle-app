// Auto-compaction: detect context overflow and compact messages via sliding window or summarization

import type { LanguageModel, ModelMessage } from 'ai'
import { generateText } from 'ai'

export interface CompactionConfig {
  /** Number of recent messages to keep (Alma default: 4) */
  keepRecentMessages: number
  /** Model's context window in tokens */
  contextWindow: number
  /** Max output tokens to reserve */
  maxOutputReserve: number
}

const DEFAULT_CONFIG: CompactionConfig = {
  keepRecentMessages: 4,
  contextWindow: 128_000,
  maxOutputReserve: 32_000,
}

/**
 * Check if the context is overflowing based on actual token usage.
 * Uses the same logic as Alma's FE() function.
 */
export function isContextOverflow(
  usage: { inputTokens: number, outputTokens: number, cacheReadTokens?: number },
  config: CompactionConfig,
): boolean {
  const effectiveTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
  const reserve = Math.min(config.maxOutputReserve, 32_000)
  return effectiveTokens > config.contextWindow - reserve
}

/**
 * Compact messages by keeping only the most recent N messages.
 * System messages are always preserved.
 * Tool-call and tool-result message pairs are kept together to avoid orphans.
 */
export function compactByWindow(
  messages: ModelMessage[],
  keepMessages: number = DEFAULT_CONFIG.keepRecentMessages,
): ModelMessage[] {
  const systemMessages = messages.filter(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')

  if (nonSystem.length <= keepMessages) {
    return messages
  }

  // Start with the last N messages
  let startIdx = nonSystem.length - keepMessages

  // Ensure we don't start on a 'tool' message (orphaned tool result).
  // Walk back to include the preceding assistant message with tool_call.
  while (startIdx > 0 && nonSystem[startIdx].role === 'tool') {
    startIdx--
  }

  const kept = nonSystem.slice(startIdx)
  return [...systemMessages, ...kept]
}

export function resolveCompactionConfig(overrides?: Partial<CompactionConfig>): CompactionConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Summarize the following conversation messages into a concise summary that preserves:
- Key facts and decisions made
- Important context and constraints mentioned
- Current state of any tasks being discussed
Be concise — focus on information that would be needed to continue the conversation.`

/**
 * Compact messages by summarizing older messages and keeping recent ones.
 * Falls back to compactByWindow if summarization fails.
 */
export async function compactWithSummary(
  messages: ModelMessage[],
  model: LanguageModel,
  keepMessages: number = DEFAULT_CONFIG.keepRecentMessages,
): Promise<ModelMessage[]> {
  const systemMessages = messages.filter(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')

  if (nonSystem.length <= keepMessages) {
    return messages
  }

  let startIdx = nonSystem.length - keepMessages
  while (startIdx > 0 && nonSystem[startIdx].role === 'tool') {
    startIdx--
  }

  const recentMessages = nonSystem.slice(startIdx)
  const olderMessages = nonSystem.slice(0, startIdx)

  if (olderMessages.length === 0) {
    return messages
  }

  try {
    const conversationText = olderMessages
      .map(formatSummaryMessageLine)
      .join('\n')

    const summary = await generateText({
      model,
      system: SUMMARIZATION_PROMPT,
      prompt: conversationText,
    })

    return [
      ...systemMessages,
      { role: 'user' as const, content: `<context_summary>\n${summary.text}\n</context_summary>` },
      { role: 'user' as const, content: '<system-reminder>Context was automatically compacted. Continue from where you left off.</system-reminder>' },
      ...recentMessages,
    ]
  }
  catch {
    // Summarization failed — fall back to window compaction
    return [...systemMessages, ...recentMessages]
  }
}

function formatSummaryMessageLine(message: ModelMessage): string {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content)
  return `${message.role}: ${content}`
}
