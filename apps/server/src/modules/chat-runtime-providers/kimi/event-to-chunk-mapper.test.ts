import { describe, expect, it } from 'vitest'

import { KimiEventToChunkMapper } from './event-to-chunk-mapper'
import type { KimiTranscriptTurn } from './transcript-projector'

describe('kimi event to chunk mapper', () => {
  it('projects streamed text, thinking, tools, and a terminal turn', () => {
    const mapper = new KimiEventToChunkMapper()
    const text = mapper.map(event({ type: 'assistant.delta', turnId: 7, delta: 'Hello' }))
    const thinking = mapper.map(event({ type: 'thinking.delta', turnId: 7, delta: 'reasoning' }))
    const tool = mapper.map(event({ type: 'tool.call.started', turnId: 7, toolCallId: 'call-1', name: 'shell', args: { command: 'pwd' } }))
    const result = mapper.map(event({ type: 'tool.result', turnId: 7, toolCallId: 'call-1', output: 'ok' }))
    const finish = mapper.map(event({ type: 'turn.ended', turnId: 7, reason: 'completed' }))

    expect(text.map(chunk => chunk.type)).toEqual(['text-start', 'text-delta'])
    expect(thinking.map(chunk => chunk.type)).toEqual(['reasoning-start', 'reasoning-delta'])
    expect(tool.map(chunk => chunk.type)).toEqual([
      'text-end',
      'reasoning-end',
      'tool-input-start',
      'tool-input-available',
    ])
    expect(result.map(chunk => chunk.type)).toEqual(['tool-output-available'])
    expect(finish.map(chunk => chunk.type)).toEqual(['data-runtime-event', 'finish'])
    expect(finish[0]).toMatchObject({
      type: 'data-runtime-event',
      data: { kind: 'kimi.turn.ended', reason: 'completed', interruptReason: null },
    })
  })

  it('preserves interruptReason and maps limit/filter interrupts to finish error', () => {
    const mapper = new KimiEventToChunkMapper()
    const finish = mapper.map(event({
      type: 'turn.ended',
      turnId: 9,
      reason: 'cancelled',
      interruptReason: 'max_steps',
    }))

    expect(finish).toMatchObject([
      {
        type: 'data-runtime-event',
        data: {
          kind: 'kimi.turn.ended',
          turnId: 9,
          reason: 'cancelled',
          interruptReason: 'max_steps',
        },
      },
      { type: 'finish', finishReason: 'error' },
    ])
  })

  it('keeps user_cancelled interrupts as a clean stop finish', () => {
    const mapper = new KimiEventToChunkMapper()
    const finish = mapper.map(event({
      type: 'turn.ended',
      turnId: 3,
      reason: 'cancelled',
      interruptReason: 'user_cancelled',
    }))

    expect(finish).toMatchObject([
      {
        type: 'data-runtime-event',
        data: { kind: 'kimi.turn.ended', interruptReason: 'user_cancelled' },
      },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('splits text and thinking blocks around tools in the same Kimi turn', () => {
    const mapper = new KimiEventToChunkMapper()

    const prelude = mapper.map(event({ type: 'assistant.delta', turnId: 7, delta: 'I will check.' }))
    const thinking = mapper.map(event({ type: 'thinking.delta', turnId: 7, delta: 'Checking.' }))
    const tool = mapper.map(event({ type: 'tool.call.started', turnId: 7, toolCallId: 'call-1', name: 'shell', args: { command: 'pwd' } }))
    const answer = mapper.map(event({ type: 'assistant.delta', turnId: 7, delta: 'Done.' }))
    const finalThinking = mapper.map(event({ type: 'thinking.delta', turnId: 7, delta: 'Verified.' }))
    const finish = mapper.map(event({ type: 'turn.ended', turnId: 7, reason: 'completed' }))

    expect(prelude.map(chunk => chunk.type)).toEqual(['text-start', 'text-delta'])
    expect(prelude[0]).toMatchObject({ id: 'kimi-text-7' })
    expect(thinking).toMatchObject([
      { type: 'reasoning-start', id: 'kimi-thinking-7' },
      { type: 'reasoning-delta', id: 'kimi-thinking-7', delta: 'Checking.' },
    ])
    expect(tool.map(chunk => chunk.type)).toEqual([
      'text-end',
      'reasoning-end',
      'tool-input-start',
      'tool-input-available',
    ])
    expect(tool[0]).toMatchObject({ id: 'kimi-text-7' })
    expect(tool[1]).toMatchObject({ id: 'kimi-thinking-7' })
    expect(answer).toMatchObject([
      { type: 'text-start', id: 'kimi-text-7-1' },
      { type: 'text-delta', id: 'kimi-text-7-1', delta: 'Done.' },
    ])
    expect(finalThinking).toMatchObject([
      { type: 'reasoning-start', id: 'kimi-thinking-7-1' },
      { type: 'reasoning-delta', id: 'kimi-thinking-7-1', delta: 'Verified.' },
    ])
    expect(finish).toMatchObject([
      { type: 'text-end', id: 'kimi-text-7-1' },
      { type: 'reasoning-end', id: 'kimi-thinking-7-1' },
      { type: 'data-runtime-event', data: { kind: 'kimi.turn.ended', reason: 'completed' } },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('closes active blocks when REST recovery observes a terminal prompt', () => {
    const mapper = new KimiEventToChunkMapper()
    mapper.map(event({ type: 'assistant.delta', turnId: 7, delta: 'Recovered' }))

    const recovered = mapper.reconcileTranscriptTurn({
      kind: 'turn',
      turnId: 't7',
      ordinal: 1,
      origin: { kind: 'user' },
      state: 'completed',
      steps: [{
        kind: 'step',
        stepId: 'step-1',
        turnId: 't7',
        ordinal: 1,
        state: 'completed',
        frames: [
          { kind: 'text', frameId: 'text-1', role: 'assistant', text: 'Recovered text' },
          {
            kind: 'tool',
            frameId: 'tool-frame-1',
            toolCallId: 'tool-recovered',
            name: 'Bash',
            input: { command: 'pwd' },
            output: 'ok',
            state: 'done',
          },
          { kind: 'text', frameId: 'text-2', role: 'assistant', text: ' Done.' },
        ],
      }],
    } as KimiTranscriptTurn)

    expect(recovered.map(chunk => chunk.type)).toEqual([
      'text-delta',
      'text-end',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'text-start',
      'text-delta',
    ])
    expect(mapper.finishFromRecovery('failed')).toEqual([
      { type: 'text-end', id: 'kimi-text-7-1' },
      {
        type: 'data-runtime-event',
        data: {
          kind: 'kimi.turn.ended',
          turnId: null,
          reason: 'failed',
          interruptReason: null,
          durationMs: null,
          error: null,
        },
      },
      { type: 'finish', finishReason: 'error' },
    ])
  })
})

function event(payload: Parameters<KimiEventToChunkMapper['map']>[0]['payload']): Parameters<KimiEventToChunkMapper['map']>[0] {
  return { type: payload.type, seq: 1, timestamp: '2026-07-20T00:00:00.000Z', session_id: 'session-1', payload }
}
