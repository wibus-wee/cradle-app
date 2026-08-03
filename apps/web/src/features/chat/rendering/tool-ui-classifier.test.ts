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

  it('surfaces Codex plugin command provenance in terminal tool titles and summaries', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'codex',
      apiName: 'command_execution',
      kind: 'terminal',
      args: {
        command: 'node ./hooks/run.js',
        pluginId: 'plugin-github',
        scriptPath: 'hooks/run.js',
      },
    }, 'tool-command_execution'))

    expect(descriptor.kind).toBe('terminal')
    expect(descriptor.title).toBe('Run plugin-github')
    expect(descriptor.summary).toBe('plugin-github · hooks/run.js')
    expect(descriptor.target).toBe('node ./hooks/run.js')
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

  it('labels a native agent wait as waiting rather than launching a subagent', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'codex',
      apiName: 'wait',
      kind: 'subagent',
      args: {
        tool: 'wait',
        receiverThreadIds: [],
      },
    }, 'tool-wait'))

    expect(descriptor.kind).toBe('subagent')
    expect(descriptor.title).toBe('Wait for agents')
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

describe('readToolPayload', () => {
  it('exposes a legacy truncated json payload preview instead of an empty block', () => {
    const marker = {
      type: 'cradle.truncated-json-payload.v1',
      originalChars: 250_000,
      preview: '{"huge":"prefix',
    }

    const payload = readToolPayload(marker)

    expect(payload.rawText).toBe(marker.preview)
    expect(payload.rawValue).toBe(marker)
    expect(payload.truncatedOriginalChars).toBe(250_000)
    expect(payload.blobId).toBeNull()
    expect(payload.type).toBeNull()
  })

  it('exposes a legacy truncated text payload preview instead of an empty block', () => {
    const marker = {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: 180_000,
      preview: 'partial stdout that used to vanish',
    }

    const payload = readToolPayload(marker)

    expect(payload.rawText).toBe(marker.preview)
    expect(payload.rawValue).toBe(marker)
    expect(payload.truncatedOriginalChars).toBe(180_000)
    expect(payload.blobId).toBeNull()
  })

  it('exposes a blob payload ref preview with its fetchable blob id', () => {
    const ref = {
      type: 'cradle.blob-payload-ref.v1',
      blobId: 'blob_abc123',
      mediaType: 'application/json',
      originalChars: 900_000,
      preview: '{"ok":true',
    }

    const payload = readToolPayload(ref)

    expect(payload.rawText).toBe(ref.preview)
    expect(payload.rawValue).toBe(ref)
    expect(payload.truncatedOriginalChars).toBe(900_000)
    expect(payload.blobId).toBe('blob_abc123')
  })

  it('classifies an ordinary inline payload exactly as before', () => {
    const value = {
      command: 'git status',
      description: 'Show working tree status',
      stdout: 'clean',
    }

    const payload = readToolPayload(value)

    expect(payload.rawValue).toBe(value)
    expect(payload.rawText).toBeNull()
    expect(payload.truncatedOriginalChars).toBeNull()
    expect(payload.blobId).toBeNull()
    expect(payload.command).toBe('git status')
    expect(payload.description).toBe('Show working tree status')
    expect(payload.stdout).toBe('clean')
  })
})
