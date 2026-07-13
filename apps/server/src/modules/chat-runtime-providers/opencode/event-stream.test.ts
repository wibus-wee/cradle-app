import type {
  AssistantMessage as OpencodeAssistantMessage,
  Part as OpencodePart,
  ToolPart as OpencodeToolPart,
} from '@opencode-ai/sdk'
import { describe, expect, it } from 'vitest'

import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import type { OpencodeStreamEvent } from './event-stream'
import { isTerminalOpencodeAssistant, OpencodeEventStreamProjector } from './event-stream'

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

  it('re-emits tool input when OpenCode updates pending empty input with runnable arguments', () => {
    const projector = new OpencodeEventStreamProjector('ses_1')
    const pendingToolPart = {
      id: 'part_tool',
      sessionID: 'ses_1',
      messageID: 'msg_assistant',
      type: 'tool',
      callID: 'call_1',
      tool: 'bash',
      state: {
        status: 'pending',
        input: {},
        raw: '',
      },
    } satisfies OpencodeToolPart
    const runningToolPart = {
      ...pendingToolPart,
      state: {
        status: 'running',
        input: { command: 'pnpm typecheck', workdir: '/tmp/workspace' },
        title: 'Running command',
        metadata: {},
        time: { start: 1 },
      },
    } satisfies OpencodeToolPart

    const chunks = [
      ...projector.projectEvent({
        type: 'message.updated',
        properties: { info: assistantMessage() },
      }),
      ...projector.projectEvent({
        type: 'message.part.updated',
        properties: { part: pendingToolPart },
      }),
      ...projector.projectEvent({
        type: 'message.part.updated',
        properties: { part: runningToolPart },
      }),
    ]

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'tool-input-available',
      'tool-output-available',
    ])
    expect(chunks.filter(chunk => chunk.type === 'tool-input-available').at(-1)).toMatchObject({
      toolCallId: 'call_1',
      input: expect.objectContaining({
        args: expect.objectContaining({
          command: 'pnpm typecheck',
          workdir: '/tmp/workspace',
        }),
      }),
    })
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

  it('does not duplicate pending text deltas when the later part snapshot already includes them', () => {
    const projector = new OpencodeEventStreamProjector('ses_1')

    const chunks = [
      ...projector.projectEvent({
        type: 'message.updated',
        properties: { info: assistantMessage({ time: { created: 1 }, finish: undefined }) },
      }),
      ...projector.projectEvent({
        type: 'message.part.delta',
        properties: {
          sessionID: 'ses_1',
          messageID: 'msg_assistant',
          partID: 'part_text',
          delta: 'Hel',
        },
      }),
      ...projector.projectEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_text',
            sessionID: 'ses_1',
            messageID: 'msg_assistant',
            type: 'text',
            text: 'Hel',
            time: { start: 1 },
          } satisfies OpencodePart,
        },
      }),
    ]

    expect(chunks).toMatchObject([
      { type: 'text-start', id: 'part_text' },
      { type: 'text-delta', id: 'part_text', delta: 'Hel' },
    ])
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('')).toBe('Hel')
  })

  it('projects session.next text, reasoning, tool, and terminal step events', () => {
    const projector = new OpencodeEventStreamProjector('ses_1')
    const nextEvent = (event: OpencodeStreamEvent): OpencodeStreamEvent => event

    const chunks = [
      ...projector.projectEvent(nextEvent({
        type: 'session.next.text.delta',
        properties: { sessionID: 'ses_1', timestamp: 1, delta: 'Hel' },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.text.ended',
        properties: { sessionID: 'ses_1', timestamp: 2, text: 'Hello' },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.reasoning.delta',
        properties: { sessionID: 'ses_1', timestamp: 3, reasoningID: 'reasoning_1', delta: 'Thinking' },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.reasoning.ended',
        properties: { sessionID: 'ses_1', timestamp: 4, reasoningID: 'reasoning_1', text: 'Thinking' },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.tool.called',
        properties: {
          sessionID: 'ses_1',
          timestamp: 5,
          callID: 'call_1',
          tool: 'read',
          input: { filePath: 'README.md' },
        },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.tool.progress',
        properties: {
          sessionID: 'ses_1',
          timestamp: 6,
          callID: 'call_1',
          content: 'Reading README.md',
        },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.tool.success',
        properties: {
          sessionID: 'ses_1',
          timestamp: 7,
          callID: 'call_1',
          content: 'Done',
          structured: { bytes: 42 },
        },
      })),
      ...projector.projectEvent(nextEvent({
        type: 'session.next.step.ended',
        properties: {
          sessionID: 'ses_1',
          timestamp: 8,
          finish: 'stop',
          tokens: {
            input: 10,
            output: 3,
            reasoning: 2,
            cache: { read: 0, write: 0 },
          },
        },
      })),
    ]

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'tool-output-available',
      'finish',
    ])
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('')).toBe('Hello')
    expect(projector.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 2,
    })
    assertValidProviderChunkSequence(chunks)
  })

  it('projects session.next step failures as provider errors', () => {
    const projector = new OpencodeEventStreamProjector('ses_1')

    expect(projector.projectEvent({
      type: 'session.next.step.failed',
      properties: {
        sessionID: 'ses_1',
        timestamp: 1,
        error: { message: 'model overloaded' },
      },
    } satisfies OpencodeStreamEvent)).toEqual([
      { type: 'error', errorText: 'model overloaded' },
    ])
  })

  it('does not treat tool-calls finish as terminal', () => {
    expect(isTerminalOpencodeAssistant(assistantMessage({
      finish: 'tool-calls',
      time: { created: 1, completed: 2 },
    }))).toBe(false)
    expect(isTerminalOpencodeAssistant(assistantMessage({
      finish: 'unknown',
      time: { created: 1, completed: 2 },
    }))).toBe(false)
    expect(isTerminalOpencodeAssistant(assistantMessage({
      finish: 'stop',
      time: { created: 1, completed: 2 },
    }))).toBe(true)
  })
})
