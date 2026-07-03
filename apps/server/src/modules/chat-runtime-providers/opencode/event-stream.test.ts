import type {
  AssistantMessage as OpencodeAssistantMessage,
  Part as OpencodePart,
  ToolPart as OpencodeToolPart,
} from '@opencode-ai/sdk'
import { describe, expect, it } from 'vitest'

import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import { OpencodeEventStreamProjector } from './event-stream'

function assistantMessage(input: Partial<OpencodeAssistantMessage> = {}): OpencodeAssistantMessage {
  return {
    id: input.id ?? 'msg_assistant',
    sessionID: input.sessionID ?? 'ses_1',
    role: 'assistant',
    time: input.time ?? { created: 1, completed: 2 },
    parentID: input.parentID ?? 'msg_user',
    modelID: input.modelID ?? 'gpt-5',
    providerID: input.providerID ?? 'openai',
    mode: input.mode ?? 'build',
    path: input.path ?? { cwd: '/tmp/workspace', root: '/tmp/workspace' },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? {
      input: 10,
      output: 3,
      reasoning: 2,
      cache: { read: 0, write: 0 },
    },
    finish: input.finish ?? 'stop',
  }
}

describe('opencodeEventStreamProjector', () => {
  it('projects OpenCode streamed tool parts before final assistant text', () => {
    const projector = new OpencodeEventStreamProjector('ses_1')
    const toolPart = {
      id: 'part_tool',
      sessionID: 'ses_1',
      messageID: 'msg_assistant',
      type: 'tool',
      callID: 'call_1',
      tool: 'bash',
      state: {
        status: 'running',
        input: { command: 'pnpm typecheck:server' },
        title: 'Running command',
        metadata: {},
        time: { start: 1 },
      },
    } satisfies OpencodeToolPart
    const completedToolPart = {
      ...toolPart,
      state: {
        status: 'completed',
        input: { command: 'pnpm typecheck:server' },
        output: 'No errors',
        title: 'Command completed',
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } satisfies OpencodeToolPart
    const textPart = {
      id: 'part_text',
      sessionID: 'ses_1',
      messageID: 'msg_assistant',
      type: 'text',
      text: 'Done.',
      time: { start: 3, end: 4 },
    } satisfies OpencodePart

    const chunks = [
      ...projector.projectEvent({
        type: 'message.updated',
        properties: { info: assistantMessage() },
      }),
      ...projector.projectEvent({
        type: 'message.part.updated',
        properties: { part: toolPart },
      }),
      ...projector.projectEvent({
        type: 'message.part.updated',
        properties: { part: completedToolPart },
      }),
      ...projector.projectPromptResult({
        info: assistantMessage(),
        parts: [completedToolPart, textPart],
      }),
      projector.finish(assistantMessage()),
    ]

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'tool-output-available',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    expect(chunks.find(chunk => chunk.type === 'text-delta')).toMatchObject({
      delta: 'Done.',
    })
    assertValidProviderChunkSequence(chunks)
  })

  it('buffers text deltas until the assistant message role is known', () => {
    const projector = new OpencodeEventStreamProjector('ses_1')
    const textPart = {
      id: 'part_text',
      sessionID: 'ses_1',
      messageID: 'msg_assistant',
      type: 'text',
      text: '',
      time: { start: 1 },
    } satisfies OpencodePart

    expect(projector.projectEvent({
      type: 'message.part.updated',
      properties: { part: textPart },
    })).toEqual([])
    expect(projector.projectEvent({
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_1',
        messageID: 'msg_assistant',
        partID: 'part_text',
        delta: 'Hel',
      },
    })).toEqual([])

    const chunks = projector.projectEvent({
      type: 'message.updated',
      properties: { info: assistantMessage() },
    })

    expect(chunks).toMatchObject([
      { type: 'text-start', id: 'part_text' },
      { type: 'text-delta', id: 'part_text', delta: 'Hel' },
    ])
  })
})
