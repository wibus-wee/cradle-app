import { describe, expect, it } from 'vitest'

import type { RenderableToolPart } from './tool-ui-classifier'
import { describeToolCall, describeToolCallCached, readToolPayload } from './tool-ui-classifier'

function toolPart(input: unknown, type = 'tool-Bash'): RenderableToolPart {
  return {
    type: type as `tool-${string}`,
    toolCallId: 'tool-call-1',
    state: 'output-available',
    input,
  }
}

describe('describeToolCall', () => {
  it('trusts the server-computed canonical kind carried on the builtin envelope', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Bash',
      kind: 'terminal',
      args: {
        command: 'git status',
        description: 'Show working tree status',
      },
    }))

    expect(descriptor.kind).toBe('terminal')
    expect(descriptor.title).toBe('Show working tree status')
    expect(descriptor.target).toBe('git status')
  })

  it('classifies canonical Claude Code Agent as subagent from the envelope kind', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Agent',
      kind: 'subagent',
      args: {
        description: 'Investigate the failure',
      },
    }, 'tool-Agent'))

    expect(descriptor.kind).toBe('subagent')
    expect(descriptor.target).toBe('Investigate the failure')
  })

  it('never promotes a Bash call to subagent just because it carries a description', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Bash',
      kind: 'terminal',
      args: {
        command: 'git status',
        description: 'Looks like a subagent launch, but it is not',
      },
    }))

    expect(descriptor.kind).toBe('terminal')
  })

  it('falls back to generic for envelopes persisted before kind existed', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Bash',
      args: {
        command: 'git status',
      },
    }))

    expect(descriptor.kind).toBe('generic')
  })

  it('does not promote raw payload fields into semantic tool kinds', () => {
    const descriptor = describeToolCall(toolPart({
      command: 'git status',
      description: 'Show working tree status',
    }))

    expect(descriptor.kind).toBe('generic')
    expect(descriptor.title).toBe('Show working tree status')
    expect(descriptor.toolName).toBe('tool-Bash')
    expect(descriptor.displayName).toBe('Tool Bash')
  })

  it('reuses cached descriptors for unchanged tool parts', () => {
    const part = toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Bash',
      kind: 'terminal',
      args: {
        command: 'git status',
        description: 'Show working tree status',
      },
    })

    expect(describeToolCallCached(part)).toBe(describeToolCallCached(part))
  })

  it('invalidates cached descriptors when tool input or output changes', () => {
    const part = toolPart({})
    const initialDescriptor = describeToolCallCached(part)

    part.input = {
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Bash',
      kind: 'terminal',
      args: {
        command: 'git status',
      },
    }
    const inputDescriptor = describeToolCallCached(part)

    part.input = {}
    part.output = {
      type: 'cradle.builtin-tool-call.result.v1',
      identifier: 'claude-code',
      apiName: 'Read',
      kind: 'file-read',
      result: 'content',
    }
    const outputDescriptor = describeToolCallCached(part)

    expect(inputDescriptor).not.toBe(initialDescriptor)
    expect(inputDescriptor.kind).toBe('terminal')
    expect(outputDescriptor).not.toBe(inputDescriptor)
    expect(outputDescriptor.kind).toBe('file-read')
  })

  it('preserves the complete Workflow payload and lifecycle for detail rendering', () => {
    const input = {
      script: 'export const meta = { name: \'research\', phases: [] }',
      name: 'research',
      args: { question: 'What changed?' },
      scriptPath: '/tmp/research.js',
      futureInputField: { preserve: true },
    }
    const output = {
      status: 'async_launched',
      taskId: 'workflow-task-1',
      taskType: 'local_workflow',
      workflowName: 'research',
      runId: 'wf_run_1',
      futureOutputField: ['preserve', 'this'],
      lifecycle: [{
        type: 'task_notification',
        taskId: 'workflow-task-1',
        status: 'completed',
      }],
    }

    const inputPayload = readToolPayload(input)
    const outputPayload = readToolPayload(output)

    expect(inputPayload.rawValue).toBe(input)
    expect(outputPayload.rawValue).toBe(output)
    expect(outputPayload.workflowLifecycle).toEqual(output.lifecycle)
    expect(outputPayload.workflowRunId).toBe('wf_run_1')
  })
})
