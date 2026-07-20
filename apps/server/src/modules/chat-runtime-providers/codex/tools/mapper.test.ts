import { describe, expect, it } from 'vitest'

import {
  buildCodexToolInput,
  buildCodexToolOutput,
  classifyCodexToolKind,
  readCodexToolName,
} from './mapper'

describe('classifyCodexToolKind', () => {
  it('classifies collabAgentToolCall items as subagent regardless of concrete tool name', () => {
    for (const apiName of ['spawnAgent', 'sendInput', 'resumeAgent', 'wait', 'closeAgent', 'collab_agent'] as const) {
      expect(classifyCodexToolKind(apiName, 'collabAgentToolCall')).toBe('subagent')
    }
  })

  it('classifies CollabAgentTool api names as subagent when item type is omitted', () => {
    expect(classifyCodexToolKind('spawnAgent')).toBe('subagent')
    expect(classifyCodexToolKind('sendInput')).toBe('subagent')
    expect(classifyCodexToolKind('resumeAgent')).toBe('subagent')
    expect(classifyCodexToolKind('wait')).toBe('subagent')
    expect(classifyCodexToolKind('closeAgent')).toBe('subagent')
    expect(classifyCodexToolKind('collab_agent')).toBe('subagent')
  })

  it('keeps unrelated api names on their existing kinds', () => {
    expect(classifyCodexToolKind('sleep')).toBe('generic')
    expect(classifyCodexToolKind('command_execution')).toBe('terminal')
    expect(classifyCodexToolKind('server/tool', 'mcpToolCall')).toBe('mcp')
  })
})

describe('buildCodexToolInput/output for collabAgentToolCall', () => {
  it('projects wait/sendInput/resumeAgent envelopes with kind subagent', () => {
    for (const tool of ['wait', 'sendInput', 'resumeAgent', 'spawnAgent', 'closeAgent'] as const) {
      const item = {
        type: 'collabAgentToolCall',
        id: `crew-${tool}`,
        tool,
        status: 'inProgress',
        senderThreadId: 'parent-thread',
        receiverThreadIds: ['subagent-thread'],
        prompt: tool === 'sendInput' ? 'Continue' : null,
        model: null,
        agentsStates: {
          'subagent-thread': { status: 'running', message: 'Working' },
        },
      }

      expect(readCodexToolName(item)).toBe(tool)

      const input = buildCodexToolInput(item)
      expect(input.apiName).toBe(tool)
      expect(input.kind).toBe('subagent')
      expect(input.args).toEqual(expect.objectContaining({
        tool,
        senderThreadId: 'parent-thread',
        receiverThreadIds: ['subagent-thread'],
      }))

      const output = buildCodexToolOutput({ ...item, status: 'completed' })
      expect(output.apiName).toBe(tool)
      expect(output.kind).toBe('subagent')
      expect(output.result).toEqual(expect.objectContaining({
        tool,
        status: 'completed',
        receiverThreadIds: ['subagent-thread'],
      }))
    }
  })
})
