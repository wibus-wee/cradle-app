import { describe, expect, it } from 'vitest'

import { KimiEventToChunkMapper } from './event-to-chunk-mapper'

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
    expect(finish.map(chunk => chunk.type)).toEqual(['finish'])
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
      { type: 'finish', finishReason: 'stop' },
    ])
  })
})

function event(payload: Parameters<KimiEventToChunkMapper['map']>[0]['payload']): Parameters<KimiEventToChunkMapper['map']>[0] {
  return { type: payload.type, seq: 1, timestamp: '2026-07-20T00:00:00.000Z', session_id: 'session-1', payload }
}
