import { describe, expect, it } from 'vitest'

import type { ClaudeWorkflowEvent } from './event-parser'
import { ClaudeWorkflowStateReducer } from './state-reducer'

describe('claudeWorkflowStateReducer', () => {
  it('infers one unique prompt and reconciles final authoritative state', () => {
    const reducer = new ClaudeWorkflowStateReducer({
      runId: 'wf_1',
name: 'review',
description: null,
status: 'running',
startedAt: 1,
    })
    reducer.apply({
      kind: 'workflow-declared',
      observedAt: 2,
      declaration: {
        name: 'review',
        description: 'Review code',
        phases: [{ index: 1, title: 'Review', detail: null }],
        agents: [{
          declarationId: 'declared-agent-1',
index: 1,
label: 'review:errors',
phaseIndex: 1,
          phaseTitle: 'Review',
prompt: 'Inspect errors',
        }],
        branchCount: 1,
        exploredPathCount: 2,
        incomplete: false,
      },
    })
    reducer.apply(agentEvent({ agentId: 'agent-1', status: 'running', prompt: 'Inspect errors' }))

    expect(reducer.snapshot()).toMatchObject({
      currentPhase: { index: 1, title: 'Review', status: 'running' },
      agents: [{
        id: 'agent-1',
declarationId: 'declared-agent-1',
label: 'review:errors',
        alignment: 'inferred',
phaseIndex: 1,
status: 'running',
      }],
    })

    reducer.apply({
      ...agentEvent({ agentId: 'agent-1', status: 'completed', prompt: 'Inspect errors' }),
      label: 'review:errors',
      phaseIndex: 1,
      phaseTitle: 'Review',
      authoritative: true,
      totalTokens: 50,
      toolUses: 4,
    })
    reducer.apply({
      kind: 'workflow-observed',
runId: 'wf_1',
name: 'review',
description: null,
      status: 'completed',
startedAt: 1,
durationMs: 100,
result: 'done',
totalTokens: 50,
      totalToolCalls: 4,
declaredPhases: [{ index: 1, title: 'Review', detail: null }],
logs: [],
    })

    expect(reducer.snapshot()).toMatchObject({
      workflow: { status: 'completed', result: 'done' },
      agents: [{ id: 'agent-1', alignment: 'observed', status: 'completed', totalTokens: 50 }],
    })
  })

  it('does not infer duplicate prompts and removes impossible declarations after final output', () => {
    const reducer = new ClaudeWorkflowStateReducer({
      runId: 'wf_2',
name: null,
description: null,
status: 'running',
startedAt: 1,
    })
    reducer.apply({
      kind: 'workflow-declared',
observedAt: 2,
      declaration: {
        name: null,
description: null,
phases: [],
branchCount: 1,
exploredPathCount: 2,
incomplete: false,
        agents: [
          { declarationId: 'a', index: 1, label: 'left', phaseIndex: null, phaseTitle: null, prompt: 'same' },
          { declarationId: 'b', index: 2, label: 'right', phaseIndex: null, phaseTitle: null, prompt: 'same' },
        ],
      },
    })
    reducer.apply(agentEvent({ agentId: 'real', status: 'running', prompt: 'same' }))
    expect(reducer.snapshot().agents.find(agent => agent.id === 'real')?.alignment).toBe('unmatched')

    reducer.apply({
      kind: 'workflow-observed',
runId: 'wf_2',
name: null,
description: null,
status: 'completed',
      startedAt: 1,
durationMs: 10,
result: null,
totalTokens: null,
totalToolCalls: null,
      declaredPhases: [],
logs: [],
    })
    expect(reducer.snapshot().agents.map(agent => agent.id)).toEqual(['real'])
  })

  it('deduplicates transcript tool events', () => {
    const reducer = new ClaudeWorkflowStateReducer({
      runId: 'wf_3',
name: null,
description: null,
status: 'running',
startedAt: 1,
    })
    const event: ClaudeWorkflowEvent = {
      kind: 'agent-tool-observed',
agentId: 'agent',
eventId: 'message',
toolCallIds: ['tool-1'],
      lastToolName: 'Read',
model: 'opus',
totalTokens: 10,
updatedAt: 2,
observedAt: 2,
    }
    reducer.apply(event)
    reducer.apply(event)
    expect(reducer.snapshot().agents[0]).toMatchObject({ toolUses: 1, totalTokens: 10 })
  })
})

function agentEvent(input: {
  agentId: string
  status: 'running' | 'completed'
  prompt: string
}): Extract<ClaudeWorkflowEvent, { kind: 'agent-observed' }> {
  return {
    kind: 'agent-observed',
agentId: input.agentId,
index: null,
label: null,
    phaseIndex: null,
phaseTitle: null,
status: input.status,
model: null,
prompt: input.prompt,
    queuedAt: null,
startedAt: 2,
updatedAt: 3,
completedAt: null,
durationMs: null,
    attempt: null,
totalTokens: null,
toolUses: null,
lastToolName: null,
lastToolSummary: null,
    result: null,
resultPreview: null,
authoritative: false,
observedAt: 3,
  }
}
