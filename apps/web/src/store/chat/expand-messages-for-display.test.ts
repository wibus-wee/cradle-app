import type { ChatMessagePartBoundary } from '@cradle/chat-runtime-contracts'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  applyPartsProjection,
  expandMessagesForDisplay,
} from './expand-messages-for-display'

function steerUser(input: {
  id: string
  sourceMessageId: string
  splitText: string
  splitParts?: ChatMessagePartBoundary[]
  text?: string
}): UIMessage {
  return {
    id: input.id,
    role: 'user',
    parts: [{ type: 'text', text: input.text ?? 'Please adjust.' }],
    metadata: {
      cradle: {
        continuation: {
          mode: 'steer',
          queueItemId: input.id,
          sourceMessageId: input.sourceMessageId,
          splitParts: input.splitParts ?? [{ type: 'text', text: input.splitText }],
        },
      },
    },
  } as UIMessage
}

describe('expandMessagesForDisplay', () => {
  it('passes through messages without steer metadata', () => {
    const rows = expandMessagesForDisplay([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
    ])
    expect(rows).toEqual([
      { rowKey: 'user-1', messageId: 'user-1', partsProjection: null, allowStreaming: true },
      { rowKey: 'assistant-1', messageId: 'assistant-1', partsProjection: null, allowStreaming: true },
    ])
  })

  it('expands a steered assistant into head, steer user, and streaming tail rows', () => {
    const rows = expandMessagesForDisplay([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      steerUser({
        id: 'steer-1',
        sourceMessageId: 'assistant-1',
        splitText: 'Before steer.',
      }),
    ])

    expect(rows.map(row => ({
      rowKey: row.rowKey,
      messageId: row.messageId,
      allowStreaming: row.allowStreaming,
      projectionType: row.partsProjection?.type ?? null,
    }))).toEqual([
      {
        rowKey: 'assistant-1#steer-head-steer-1',
        messageId: 'assistant-1',
        allowStreaming: false,
        projectionType: 'head',
      },
      {
        rowKey: 'steer-1',
        messageId: 'steer-1',
        allowStreaming: true,
        projectionType: null,
      },
      {
        rowKey: 'assistant-1#steer-tail-steer-1',
        messageId: 'assistant-1',
        allowStreaming: true,
        projectionType: 'tail',
      },
    ])

    const head = applyPartsProjection(
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      rows[0]!.partsProjection,
    )
    const tail = applyPartsProjection(
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      rows[2]!.partsProjection,
    )
    expect(head.parts).toEqual([{ type: 'text', text: 'Before steer.' }])
    expect(tail.parts).toEqual([{ type: 'text', text: ' After steer.' }])
  })

  it('keeps attachment payloads out of retained split projections', () => {
    const imageUrl = 'data:image/png;base64,large-image-payload'
    const imagePart = {
      type: 'file',
      mediaType: 'image/png',
      filename: 'screenshot.png',
      url: imageUrl,
    } as const
    const assistant: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [imagePart, { type: 'text', text: 'Before. After.' }],
    }
    const steer = steerUser({
      id: 'steer-1',
      sourceMessageId: assistant.id,
      splitText: 'unused',
    })
    const continuation = (
      steer.metadata as {
        cradle: { continuation: { splitParts: UIMessage['parts'] } }
      }
    ).cradle.continuation
    continuation.splitParts = [imagePart, { type: 'text', text: 'Before.' }]

    const rows = expandMessagesForDisplay([assistant, steer])

    expect(JSON.stringify(rows)).not.toContain(imageUrl)
    expect(applyPartsProjection(assistant, rows[0]!.partsProjection).parts).toEqual([
      imagePart,
      { type: 'text', text: 'Before.' },
    ])
    expect(applyPartsProjection(assistant, rows[2]!.partsProjection).parts).toEqual([
      { type: 'text', text: ' After.' },
    ])
  })

  it('projects a complex multi-steer chain across reasoning, tool, and partial text boundaries', () => {
    const toolPart = {
      type: 'dynamic-tool',
      toolCallId: 'tool-1',
      toolName: 'shell',
      state: 'output-available',
      input: { command: 'printf test' },
      output: { stdout: 'large canonical output' },
    } as const
    const assistant = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'reason-1 reason-2' },
        toolPart,
        { type: 'text', text: 'answer-A answer-B' },
      ],
    } as UIMessage
    const firstSteer = steerUser({
      id: 'steer-1',
      sourceMessageId: assistant.id,
      splitText: '',
      splitParts: [{ type: 'reasoning', text: 'reason-1' }],
      text: 'change the reasoning',
    })
    const secondSteer = steerUser({
      id: 'steer-2',
      sourceMessageId: assistant.id,
      splitText: '',
      splitParts: [
        { type: 'reasoning', text: 'reason-1 reason-2' },
        { type: 'dynamic-tool', toolCallId: 'tool-1' },
        { type: 'text', text: 'answer-A' },
      ],
      text: 'change the answer',
    })

    const rows = expandMessagesForDisplay([assistant, firstSteer, secondSteer])

    expect(rows.map(row => row.partsProjection?.type ?? row.messageId)).toEqual([
      'head',
      'steer-1',
      'mid',
      'steer-2',
      'tail',
    ])
    expect(applyPartsProjection(assistant, rows[0]!.partsProjection).parts).toEqual([
      { type: 'reasoning', text: 'reason-1' },
    ])
    expect(applyPartsProjection(assistant, rows[2]!.partsProjection).parts).toEqual([
      { type: 'reasoning', text: ' reason-2' },
      toolPart,
      { type: 'text', text: 'answer-A' },
    ])
    expect(applyPartsProjection(assistant, rows[4]!.partsProjection).parts).toEqual([
      { type: 'text', text: ' answer-B' },
    ])
    expect(JSON.stringify(rows)).not.toContain('large canonical output')
  })

  it('ignores legacy :steer-tail ids if they still appear in store input', () => {
    const rows = expandMessagesForDisplay([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      steerUser({
        id: 'steer-1',
        sourceMessageId: 'assistant-1',
        splitText: 'Before steer.',
      }),
      {
        id: 'assistant-1:steer-tail',
        role: 'assistant',
        parts: [{ type: 'text', text: ' After steer.' }],
      },
    ])
    expect(rows.some(row => row.messageId.includes(':steer-tail'))).toBe(false)
    expect(rows.map(row => row.rowKey)).toEqual([
      'assistant-1#steer-head-steer-1',
      'steer-1',
      'assistant-1#steer-tail-steer-1',
    ])
  })
})
