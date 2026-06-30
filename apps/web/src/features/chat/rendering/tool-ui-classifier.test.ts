import { describe, expect, it } from 'vitest'

import type { RenderableToolPart } from './tool-ui-classifier'
import { describeToolCall } from './tool-ui-classifier'

function toolPart(input: unknown, type = 'tool-Bash'): RenderableToolPart {
  return {
    type: type as `tool-${string}`,
    toolCallId: 'tool-call-1',
    state: 'output-available',
    input,
  }
}

describe('describeToolCall', () => {
  it('classifies canonical Claude Code Bash as terminal even when args contain description', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Bash',
      args: {
        command: 'git status',
        description: 'Show working tree status',
      },
    }))

    expect(descriptor.kind).toBe('terminal')
    expect(descriptor.title).toBe('Show working tree status')
    expect(descriptor.target).toBe('git status')
  })

  it('classifies canonical Claude Code Agent as subagent by identity', () => {
    const descriptor = describeToolCall(toolPart({
      type: 'cradle.builtin-tool-call.input.v1',
      identifier: 'claude-code',
      apiName: 'Agent',
      args: {
        description: 'Investigate the failure',
      },
    }, 'tool-Agent'))

    expect(descriptor.kind).toBe('subagent')
    expect(descriptor.target).toBe('Investigate the failure')
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
})
