/**
 * Output: Claude Agent SDK user-message async input stream.
 * Input: provider-projected Claude Agent user content and close signals.
 * Position: Claude Agent provider package stream primitive built on shared provider infrastructure.
 */

import { randomUUID } from 'node:crypto'

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { AsyncEventQueue } from '../async-event-queue'
import type { ClaudeAgentUserContent } from './types'

export type ClaudeAgentInputPriority = NonNullable<SDKUserMessage['priority']>
type ClaudeAgentMessageUuid = NonNullable<SDKUserMessage['uuid']>

export class ClaudeAgentInputStream implements AsyncIterable<SDKUserMessage> {
  private readonly queue = new AsyncEventQueue<SDKUserMessage>()

  constructor(initialContent?: ClaudeAgentUserContent) {
    if (initialContent !== undefined) {
      this.push(initialContent)
    }
  }

  push(
    content: ClaudeAgentUserContent,
    options: {
      parentToolUseId?: string | null
      toolUseResult?: unknown
      /** Defaults to `next` so mid-turn follow-ups queue instead of competing with interrupt semantics. */
      priority?: ClaudeAgentInputPriority
      uuid?: ClaudeAgentMessageUuid
    } = {},
  ): ClaudeAgentMessageUuid {
    const uuid = options.uuid ?? randomUUID()
    const accepted = this.queue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: options.parentToolUseId ?? null,
      ...(options.toolUseResult !== undefined ? { tool_use_result: options.toolUseResult } : {}),
      priority: options.priority ?? 'next',
      uuid,
    })
    if (!accepted) {
      throw new Error('Claude Agent input stream is closed; message was not appended')
    }
    return uuid
  }

  close(): void {
    this.queue.close()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return this.queue[Symbol.asyncIterator]()
  }
}

export async function* emptyClaudeAgentInput(): AsyncGenerator<SDKUserMessage, void, void> {}
