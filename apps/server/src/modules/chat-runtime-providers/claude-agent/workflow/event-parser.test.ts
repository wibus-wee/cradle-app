import { describe, expect, it } from 'vitest'

import { normalizeClaudeWorkflowRecord, parseClaudeWorkflowJsonlLine } from './event-parser'

describe('claude Workflow event normalization', () => {
  it('normalizes final workflow phase and agent records', () => {
    const events = normalizeClaudeWorkflowRecord({
      runId: 'wf_1',
      workflowName: 'review',
      summary: 'Review code',
      status: 'completed',
      startTime: 100,
      durationMs: 50,
      phases: [{ title: 'Review', detail: 'Inspect' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Review' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'review:errors',
          phaseIndex: 1,
          phaseTitle: 'Review',
          agentId: 'agent-1',
          state: 'done',
          model: 'opus',
          tokens: 42,
          toolCalls: 3,
        },
      ],
    }, { source: 'workflow-output', observedAt: 200 })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'phase-observed', index: 1, title: 'Review', detail: 'Inspect' }),
      expect.objectContaining({
        kind: 'agent-observed',
        agentId: 'agent-1',
        label: 'review:errors',
        phaseIndex: 1,
        status: 'completed',
        authoritative: true,
      }),
    ]))
  })

  it('normalizes live journal and transcript records', () => {
    const started = parseClaudeWorkflowJsonlLine(
      JSON.stringify({ type: 'started', agentId: 'agent-1' }),
      { source: 'journal', observedAt: 100 },
    )
    const prompt = parseClaudeWorkflowJsonlLine(JSON.stringify({
      type: 'user',
      uuid: 'message-1',
      timestamp: '2026-07-19T00:00:00.000Z',
      message: { content: 'Inspect errors' },
    }), { source: 'agent-transcript', agentId: 'agent-1', observedAt: 110 })

    expect(started).toEqual([expect.objectContaining({
      kind: 'agent-observed',
agentId: 'agent-1',
status: 'running',
authoritative: false,
    })])
    expect(prompt).toEqual([expect.objectContaining({
      kind: 'agent-observed',
agentId: 'agent-1',
prompt: 'Inspect errors',
authoritative: false,
    })])
  })
})
