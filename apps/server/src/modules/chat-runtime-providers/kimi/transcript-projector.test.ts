import { describe, expect, it } from 'vitest'

import type { KimiTranscriptData } from './transcript-projector'
import {
  findKimiPhaseTranscriptTurn,
  projectKimiTranscriptCrewState,
  projectKimiTranscriptProgressItems,
  projectKimiTranscriptTurns,
} from './transcript-projector'

describe('kimi transcript projector', () => {
  it('projects native turns, structured frames, and the paging cursor', () => {
    const result = projectKimiTranscriptTurns(transcript())

    expect(result.turns).toEqual([expect.objectContaining({
      id: 't7',
      status: 'completed',
      startedAt: Date.parse('2026-07-29T00:00:00.000Z'),
      completedAt: Date.parse('2026-07-29T00:00:02.000Z'),
      durationMs: 2_000,
      itemsView: 'full',
    })])
    expect(result.messages).toEqual([
      {
        id: 't7:user',
        role: 'user',
        parts: [{ type: 'text', text: 'Inspect the SDK changes.' }],
      },
      {
        id: 't7:assistant',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'I should delegate this.' },
          expect.objectContaining({
            type: 'dynamic-tool',
            toolCallId: 'tool-1',
            toolName: 'Agent',
            state: 'output-available',
          }),
          { type: 'text', text: 'The audit is complete.' },
        ],
      },
    ])
    expect(result.nextCursor).toBe('t7')
    expect(findKimiPhaseTranscriptTurn(transcript())?.turnId).toBe('t7')
  })

  it('projects subagent lifecycle, retry metadata, and task progress', () => {
    const data = transcript()
    const agentMetadata = new Map([
      ['sub-1', {
        model: 'kimi-k2.5-fast',
        thinkingEffort: 'high',
      }],
    ])

    expect(projectKimiTranscriptCrewState(data, 'session-1', 123, agentMetadata)).toMatchObject({
      slotId: 'kimi:crew',
      activeCount: 1,
      calls: [{
        id: 'task-1',
        status: 'running',
        receiverThreadIds: ['sub-1'],
        model: 'kimi-k2.5-fast',
        reasoningEffort: 'high',
        retry: {
          agentId: 'sub-1',
          attempt: 1,
          maxRetries: 2,
          retryDelayMs: 4_000,
          errorStatus: 529,
          errorCategory: 'overloaded',
        },
      }],
      agents: [expect.objectContaining({ threadId: 'sub-1', status: 'retrying' })],
    })
    expect(projectKimiTranscriptProgressItems(data)).toEqual([{
      id: 'task-1',
      label: 'Audit provider changes',
      status: 'inProgress',
      sourceStatus: 'running',
    }])
  })

  it('uses the oldest projected turn as the backwards paging cursor', () => {
    const data = transcript()
    data.items.unshift({
      kind: 'turn',
      turnId: 't8',
      ordinal: 2,
      origin: { kind: 'user' },
      prompt: 'Newer turn',
      state: 'completed',
      steps: [],
    })

    expect(projectKimiTranscriptTurns(data).nextCursor).toBe('t7')
  })
})

function transcript(): KimiTranscriptData {
  return {
    agent_id: 'main',
    agents: [
      { agentId: 'main', type: 'main' },
      { agentId: 'sub-1', type: 'sub', parentAgentId: 'main', label: 'Explore' },
    ],
    attachments: [],
    has_more: true,
    interactions: [],
    items: [{
      kind: 'turn',
      turnId: 't7',
      ordinal: 1,
      origin: { kind: 'user' },
      prompt: 'Inspect the SDK changes.',
      startedAt: '2026-07-29T00:00:00.000Z',
      endedAt: '2026-07-29T00:00:02.000Z',
      durationMs: 2_000,
      state: 'completed',
      steps: [{
        kind: 'step',
        stepId: 'step-1',
        turnId: 't7',
        ordinal: 1,
        state: 'completed',
        retry: {
          delayMs: 4_000,
          errorMessage: 'Provider overloaded',
          errorName: 'overloaded',
          failedAttempt: 1,
          nextAttempt: 2,
          maxAttempts: 3,
          statusCode: 529,
        },
        frames: [
          { kind: 'thinking', frameId: 'frame-thinking', text: 'I should delegate this.' },
          {
            kind: 'tool',
            frameId: 'frame-tool',
            toolCallId: 'tool-1',
            taskId: 'task-1',
            name: 'Agent',
            state: 'done',
            input: { prompt: 'Audit provider changes' },
            output: { summary: 'Done' },
            agentRefs: [{ agentId: 'sub-1', role: 'child' }],
          },
          {
            kind: 'text',
            frameId: 'frame-text',
            role: 'assistant',
            text: 'The audit is complete.',
          },
        ],
      }],
    }],
    meta: {
      activity: 'turn',
      agent: {
        model: 'kimi-k2.5',
        phase: { kind: 'ended', at: 1_785_283_202, reason: 'completed', turnId: 7 },
      },
    },
    pending_interactions: [],
    prompts: [{
      promptId: 'prompt-1',
      createdAt: '2026-07-29T00:00:00.000Z',
      status: 'completed',
    }],
    seq: 7,
    tasks: [{
      taskId: 'task-1',
      agentId: 'sub-1',
      kind: 'subagent',
      detached: false,
      description: 'Audit provider changes',
      outputTail: 'Retrying',
      state: 'running',
      startedAt: '2026-07-29T00:00:00.000Z',
    }],
    todos: [],
  }
}
