import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } from './event-to-chunk-mapper'

describe('mapClaudeAgentMessageToChunks', () => {
  it('extracts usage from assistant message', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const message = {
      type: 'assistant',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'text',
            text: 'Hello world',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      },
    } as unknown as SDKMessage

    const result = await mapClaudeAgentMessageToChunks(message, state)

    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    })
  })

  it('extracts usage from message_delta stream event', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const message = {
      type: 'stream_event',
      session_id: 'claude-session-1',
      event: {
        type: 'message_delta',
        delta: {},
        usage: {
          input_tokens: 200,
          output_tokens: 75,
        },
      },
    } as unknown as SDKMessage

    const result = await mapClaudeAgentMessageToChunks(message, state)

    expect(result.usage).toEqual({
      promptTokens: 200,
      completionTokens: 75,
      totalTokens: 275,
    })
  })

  it('extracts usage and finishes from result message', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const message = {
      type: 'result',
      session_id: 'claude-session-1',
      usage: {
        input_tokens: 300,
        output_tokens: 100,
      },
    } as unknown as SDKMessage

    const result = await mapClaudeAgentMessageToChunks(message, state)

    expect(result.usage).toEqual({
      promptTokens: 300,
      completionTokens: 100,
      totalTokens: 400,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    })
    expect(result.chunks).toEqual([
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('does not duplicate an active thinking stream when the assistant snapshot arrives before content_block_stop', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')

    await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'claude-session-thinking',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
    } as unknown as SDKMessage, state)
    await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'claude-session-thinking',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Checking the trace.' },
      },
    } as unknown as SDKMessage, state)

    const snapshot = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-thinking',
      message: {
        content: [
          { type: 'thinking', thinking: 'Checking the trace.' },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(snapshot.chunks).toEqual([])
  })

  it('does not let an active text snapshot pre-emit provider-thread text that stream deltas will emit', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const chunks: Awaited<ReturnType<typeof mapClaudeAgentMessageToChunks>>['chunks'] = []

    for (const message of [
      {
        type: 'stream_event',
        session_id: 'claude-session-text',
        parent_tool_use_id: 'toolu_parent_1',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      },
      {
        type: 'stream_event',
        session_id: 'claude-session-text',
        parent_tool_use_id: 'toolu_parent_1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Sub' },
        },
      },
    ] as SDKMessage[]) {
      const result = await mapClaudeAgentMessageToChunks(message, state)
      chunks.push(...result.chunks)
    }

    const snapshot = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-text',
      parent_tool_use_id: 'toolu_parent_1',
      message: {
        content: [
          { type: 'text', text: 'Subagent report' },
        ],
      },
    } as unknown as SDKMessage, state)
    chunks.push(...snapshot.chunks)

    const streamedRemainder = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'claude-session-text',
      parent_tool_use_id: 'toolu_parent_1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'agent report' },
      },
    } as unknown as SDKMessage, state)
    chunks.push(...streamedRemainder.chunks)

    expect(snapshot.chunks).toEqual([])
    expect(chunks
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => chunk.delta)
      .join('')).toBe('Subagent report')
  })

  it('captures Claude ExitPlanMode as a completed plan and implementation approval once', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const plan = '1. Inspect\n2. Patch\n3. Verify'
    const message = {
      type: 'assistant',
      session_id: 'claude-session-plan',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_plan_1',
            name: 'ExitPlanMode',
            input: { plan },
          },
        ],
      },
    } as unknown as SDKMessage

    const first = await mapClaudeAgentMessageToChunks(message, state)
    const second = await mapClaudeAgentMessageToChunks(message, state)

    expect(first.chunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'toolu_plan_1', toolName: 'ExitPlanMode' },
      {
        type: 'tool-input-available',
        toolCallId: 'toolu_plan_1',
        toolName: 'ExitPlanMode',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'claude-code',
          apiName: 'ExitPlanMode',
          kind: 'plan',
          args: { plan },
        },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_plan_1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'claude-code',
          apiName: 'ExitPlanMode',
          kind: 'plan',
          args: { plan },
          result: { plan },
        },
      },
      { type: 'tool-input-start', toolCallId: 'implement-plan:toolu_plan_1', toolName: 'plan_implementation' },
      {
        type: 'tool-input-available',
        toolCallId: 'implement-plan:toolu_plan_1',
        toolName: 'plan_implementation',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'claude-code',
          apiName: 'plan_implementation',
          kind: 'plan-implementation',
          args: { turnId: 'toolu_plan_1', planContent: plan },
        },
      },
      {
        type: 'tool-approval-request',
        toolCallId: 'implement-plan:toolu_plan_1',
        approvalId: 'implement-plan:toolu_plan_1',
      },
    ])
    expect(first.capturedPlans).toEqual([{ toolCallId: 'toolu_plan_1', content: plan }])
    expect(second.chunks).toEqual([])
    expect(second.capturedPlans).toEqual([])
  })

  it('captures Claude EnterPlanMode as a Cradle interaction mode update once', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const message = {
      type: 'assistant',
      session_id: 'claude-session-plan',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_enter_plan_1',
            name: 'EnterPlanMode',
          },
        ],
      },
    } as unknown as SDKMessage

    const first = await mapClaudeAgentMessageToChunks(message, state)
    const second = await mapClaudeAgentMessageToChunks(message, state)

    expect(first.chunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'toolu_enter_plan_1', toolName: 'EnterPlanMode' },
    ])
    expect(first.capturedInteractionModes).toEqual([
      { toolCallId: 'toolu_enter_plan_1', permissionMode: 'plan' },
    ])
    expect(second.chunks).toEqual([])
    expect(second.capturedInteractionModes).toEqual([])
  })

  it('ignores the Claude ExitPlanMode denial result after capturing the plan', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-plan',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_plan_1',
            name: 'ExitPlanMode',
            input: { plan: '1. Inspect\n2. Patch' },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const result = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-plan',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_plan_1',
            is_error: true,
            content: 'Error: Cradle captured the proposed plan. Stop here and wait for the user to refine or implement it in a later turn.',
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(result.chunks).toEqual([])
  })

  it('captures Claude plan-file ExitPlanMode signals and suppresses the SDK denial error', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const plan = '# Implementation Plan\n\n1. Inspect\n2. Patch\n3. Verify'

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-plan-file',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_write_plan_1',
            name: 'Write',
            input: {
              file_path: '/Users/wibus/.claude/plans/example.md',
              content: plan,
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const capture = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-plan-file',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_exit_plan_1',
            name: 'ExitPlanMode',
            input: {
              allowedPrompts: [
                { tool: 'Bash', prompt: 'run build for testing' },
              ],
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(capture.capturedPlans).toEqual([{ toolCallId: 'toolu_exit_plan_1', content: plan }])
    expect(capture.chunks).toEqual(expect.arrayContaining([
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_exit_plan_1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'claude-code',
          apiName: 'ExitPlanMode',
          kind: 'plan',
          args: {
            allowedPrompts: [
              { tool: 'Bash', prompt: 'run build for testing' },
            ],
          },
          result: { plan },
        },
      },
      { type: 'tool-approval-request', toolCallId: 'implement-plan:toolu_exit_plan_1', approvalId: 'implement-plan:toolu_exit_plan_1' },
    ]))

    const denial = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-plan-file',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_exit_plan_1',
            is_error: true,
            content: 'Exit plan mode?',
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(denial.chunks).toEqual([])
  })

  it('captures Cradle plan-file ExitPlanMode signals from yml artifacts and suppresses denial errors', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const plan = '# Implementation Plan\n\n1. Inspect\n2. Patch\n3. Verify'
    const planPath = '/Users/wibus/Library/Application Support/@cradle/desktop/data/runtimes/claude-agent/plans/example.yml'

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'cladle-session-plan-file',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_write_plan_1',
            name: 'Write',
            input: {
              file_path: planPath,
              content: plan,
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const capture = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'cradle-session-plan-file',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_exit_plan_1',
            name: 'ExitPlanMode',
            input: {
              allowedPrompts: [
                { tool: 'Bash', prompt: 'run build for testing' },
              ],
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(capture.capturedPlans).toEqual([{ toolCallId: 'toolu_exit_plan_1', content: plan }])

    const denial = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'cradle-session-plan-file',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_exit_plan_1',
            is_error: true,
            content: 'Error: Cradle captured the proposed plan. Stop here and wait for the user to refine or implement it in a later turn.',
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(denial.chunks).toEqual([])
  })

  it('synthesizes TodoWrite plugin state when the matching tool result arrives', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')

    const inputResult = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_todo_1',
            name: 'TodoWrite',
            input: {
              todos: [
                { id: 'todo-1', content: 'Inspect', status: 'pending' },
                { id: 'todo-2', content: 'Patch', activeForm: 'Patching', status: 'in_progress' },
                { id: 'todo-3', content: 'Verify', status: 'completed' },
              ],
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(inputResult.capturedTodos).toEqual([
      {
        toolCallId: 'toolu_todo_1',
        todos: [
          { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
          { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
          { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
        ],
      },
    ])

    const result = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_todo_1',
            content: { ok: true },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(result.chunks).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_todo_1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'claude-code',
          apiName: 'TodoWrite',
          kind: 'todo',
          args: {
            todos: [
              { id: 'todo-1', content: 'Inspect', status: 'pending' },
              { id: 'todo-2', content: 'Patch', activeForm: 'Patching', status: 'in_progress' },
              { id: 'todo-3', content: 'Verify', status: 'completed' },
            ],
          },
          result: {
            ok: true,
            pluginState: {
              todos: [
                { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
                { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
                { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
              ],
            },
          },
        },
      },
    ])
    expect(result.capturedTodos).toEqual([
      {
        toolCallId: 'toolu_todo_1',
        todos: [
          { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
          { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
          { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
        ],
      },
    ])
  })

  it('captures structured TaskCreate and TaskUpdate results as progress state', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-task-progress',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_task_create_1',
            name: 'TaskCreate',
            input: {
              subject: 'Map modules',
              description: 'List user-facing modules',
              activeForm: 'Mapping modules',
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const createResult = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-task-progress',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_task_create_1',
            content: 'Task #1 created successfully: Map modules',
          },
        ],
      },
      tool_use_result: {
        task: { id: '1', subject: 'Map modules' },
      },
    } as unknown as SDKMessage, state)

    expect(createResult.capturedTodos).toEqual([
      {
        toolCallId: 'toolu_task_create_1',
        source: 'Task',
        todos: [
          { id: '1', content: 'Map modules', status: 'todo', sourceStatus: 'pending' },
        ],
      },
    ])
    expect(createResult.chunks).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_task_create_1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'claude-code',
          apiName: 'TaskCreate',
          kind: 'todo',
          args: {
            subject: 'Map modules',
            description: 'List user-facing modules',
            activeForm: 'Mapping modules',
          },
          result: {
            task: { id: '1', subject: 'Map modules' },
          },
        },
      },
    ])

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-task-progress',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_task_update_1',
            name: 'TaskUpdate',
            input: {
              taskId: '1',
              status: 'in_progress',
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const updateResult = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-task-progress',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_task_update_1',
            content: 'Updated task #1 status',
          },
        ],
      },
      tool_use_result: {
        success: true,
        taskId: '1',
        updatedFields: ['status'],
        statusChange: { from: 'pending', to: 'in_progress' },
      },
    } as unknown as SDKMessage, state)

    expect(updateResult.capturedTodos).toEqual([
      {
        toolCallId: 'toolu_task_update_1',
        source: 'Task',
        todos: [
          { id: '1', content: 'Mapping modules', status: 'processing', sourceStatus: 'in_progress' },
        ],
      },
    ])
  })

  it('projects Claude tool result image content blocks as renderable file chunks', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const imageBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'image-data',
      },
    }

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-image-output',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_read_1',
            name: 'Read',
            input: { file_path: '/tmp/chart.png' },
          },
        ],
      },
    } as SDKMessage, state)

    const result = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-image-output',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_read_1',
            content: [
              { type: 'text', text: 'Rendered chart' },
              imageBlock,
            ],
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(result.chunks).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_read_1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'claude-code',
          apiName: 'Read',
          kind: 'file-read',
          args: { file_path: '/tmp/chart.png' },
          result: [
            { type: 'text', text: 'Rendered chart' },
            imageBlock,
          ],
        },
      },
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,image-data',
      },
    ])
  })

  it('captures Claude Agent tool metadata as crew state without guessing from output text', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')

    const inputResult = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-crew',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_agent_1',
            name: 'Agent',
            input: {
              description: 'Explore landing page changelog',
              prompt: 'Read four files and report the structure.',
              subagent_type: 'Explore',
              model: 'sonnet',
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(inputResult.capturedCrewCalls).toEqual([
      {
        toolCallId: 'toolu_agent_1',
        tool: 'Agent',
        agentId: null,
        prompt: 'Read four files and report the structure.',
        description: 'Explore landing page changelog',
        subagentType: 'Explore',
        model: 'sonnet',
        reasoningEffort: null,
        tools: [],
        outputFile: null,
        runInBackground: false,
        status: 'running',
        startedAt: expect.any(Number),
        completedAt: null,
      },
    ])

    const result = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-crew',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_agent_1',
            content: 'Report complete',
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(result.capturedCrewCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'toolu_agent_1',
        tool: 'Agent',
        status: 'completed',
        prompt: null,
        description: null,
        subagentType: null,
        agentId: null,
        outputFile: null,
      }),
    ])
  })

  it('keeps background Agent launches running until a task notification completes them', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-crew',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_agent_background',
            name: 'Agent',
            input: {
              description: 'Audit runtime provider',
              prompt: 'Check lifecycle handling.',
              run_in_background: true,
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    const launch = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-crew',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_agent_background',
            content: {
              status: 'async_launched',
              agentId: 'agent-af00d40e42de65d50',
              outputFile: '/tmp/agent-output.json',
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(launch.capturedCrewCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'toolu_agent_background',
        tool: 'Agent',
        agentId: 'agent-af00d40e42de65d50',
        outputFile: '/tmp/agent-output.json',
        status: 'running',
        completedAt: null,
      }),
    ])

    const notification = await mapClaudeAgentMessageToChunks({
      type: 'system',
      subtype: 'task_notification',
      session_id: 'claude-session-crew',
      uuid: 'task-notification-1',
      task_id: 'agent-af00d40e42de65d50',
      status: 'completed',
      output_file: '/tmp/agent-output.json',
      summary: 'Background audit complete',
    } as unknown as SDKMessage, state)

    expect(notification.capturedCrewCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'agent-af00d40e42de65d50',
        tool: 'Agent',
        agentId: 'agent-af00d40e42de65d50',
        status: 'completed',
        description: 'Background audit complete',
        outputFile: '/tmp/agent-output.json',
        completedAt: expect.any(Number),
      }),
    ])
  })

  it('routes an orphan task_notification with no linked tool_use to capturedTaskActivity, not capturedCrewCalls', async () => {
    // Regression test: any `task_*` event used to be pushed unconditionally into
    // `capturedCrewCalls`, so e.g. a background `Bash` script with a `description` was
    // misidentified as a Subagent. A `task_notification` whose `task_id` was never linked to a
    // real Agent/Workflow tool_use (no `task_started`, no `tool_use`/`tool_result` pair) is a
    // generic background task and must land in `capturedTaskActivity` instead.
    const state = createClaudeAgentChunkMapperState('text-1')

    const result = await mapClaudeAgentMessageToChunks({
      type: 'system',
      subtype: 'task_notification',
      session_id: 'claude-session-crew',
      uuid: 'task-notification-orphan',
      task_id: 'background-script-1',
      status: 'completed',
      output_file: '/tmp/script-output.json',
      summary: 'Background script finished',
    } as unknown as SDKMessage, state)

    expect(result.capturedCrewCalls).toEqual([])
    expect(result.capturedTaskActivity).toEqual([
      expect.objectContaining({
        id: 'background-script-1',
        label: 'Background script finished',
        status: 'completed',
      }),
    ])
  })

  it('links a local_workflow task_started by tool_use_id even without a preceding tool_use block', async () => {
    // Cradle's Workflow tool runs synchronously server-side, so the SDK never emits a `tool_use`
    // content block for it — the `tool_use_id` on the `task_started` event itself, combined with
    // `task_type: 'local_workflow'`, is the only handle available to link it as a crew call.
    const state = createClaudeAgentChunkMapperState('text-1')

    const started = await mapClaudeAgentMessageToChunks({
      type: 'system',
      subtype: 'task_started',
      session_id: 'claude-session-workflow',
      uuid: 'workflow-task-started-1',
      task_id: 'wciccg1br',
      tool_use_id: 'toolu_workflow_1',
      task_type: 'local_workflow',
      workflow_name: 'Run workflow',
      description: 'Run release workflow',
      prompt: 'Execute workflow.py',
    } as unknown as SDKMessage, state)

    expect(started.capturedCrewCalls).toEqual([
      expect.objectContaining({ toolCallId: 'toolu_workflow_1', tool: 'Workflow', status: 'running' }),
    ])

    // A later task_notification for the same task_id omits both tool_use_id and task_type — it
    // must still resolve to the same crew call via the link `task_started` registered above.
    const notification = await mapClaudeAgentMessageToChunks({
      type: 'system',
      subtype: 'task_notification',
      session_id: 'claude-session-workflow',
      uuid: 'workflow-task-notification-1',
      task_id: 'wciccg1br',
      status: 'completed',
      summary: 'Workflow complete',
    } as unknown as SDKMessage, state)

    expect(notification.capturedCrewCalls).toEqual([
      expect.objectContaining({ toolCallId: 'toolu_workflow_1', tool: 'Workflow', status: 'completed' }),
    ])
    expect(notification.capturedTaskActivity).toEqual([])
  })

  it('normalizes Claude Workflow tool calls into Cradle-owned tool payloads', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const result = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-workflow',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_workflow_1',
            name: 'workflow',
            input: { script: 'workflow.py' },
          },
        ],
      },
    } as unknown as SDKMessage, state)

    expect(result.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'toolu_workflow_1',
        toolName: 'workflow',
        input: expect.objectContaining({
          identifier: 'claude-code',
          apiName: 'Workflow',
        }),
      }),
    ]))
    expect(result.capturedCrewCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'toolu_workflow_1',
        tool: 'Workflow',
        status: 'running',
      }),
    ])
  })

  it('preserves complete Workflow input, output, and lifecycle metadata', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const workflowInput = {
      script: 'export const meta = { name: \'research\', phases: [] }\nagent(\'worker\')',
      name: 'research',
      description: 'Research workflow',
      title: 'Research title',
      args: { question: 'What changed?' },
      scriptPath: '/tmp/workflow.js',
      resumeFromRunId: 'wf_previous',
    }
    const workflowOutput = {
      status: 'async_launched',
      taskId: 'workflow-task-1',
      taskType: 'local_workflow',
      workflowName: 'research',
      runId: 'wf_run_1',
      summary: 'Workflow launched',
      transcriptDir: '/tmp/transcripts/workflow-task-1',
      scriptPath: '/tmp/workflow.js',
      warning: 'Local branch differs',
    }

    await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'claude-session-workflow-full',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_workflow_full',
          name: 'Workflow',
          input: workflowInput,
        }],
      },
    } as unknown as SDKMessage, state)

    const launched = await mapClaudeAgentMessageToChunks({
      type: 'user',
      session_id: 'claude-session-workflow-full',
      tool_use_result: workflowOutput,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_workflow_full',
          content: 'Workflow launched with task workflow-task-1',
        }],
      },
    } as unknown as SDKMessage, state)

    expect(launched.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-output-available',
        output: expect.objectContaining({
          result: workflowOutput,
        }),
      }),
    ]))
    expect(launched.capturedCrewCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'toolu_workflow_full',
        status: 'running',
        workflow: {
          toolCallId: 'toolu_workflow_full',
          tool: 'Workflow',
          status: 'running',
          input: workflowInput,
          output: expect.objectContaining(workflowOutput),
          lifecycle: [],
          rawInput: workflowInput,
          rawOutput: workflowOutput,
          rawLifecycle: [],
          startedAt: 0,
          completedAt: null,
        },
      }),
    ])

    const notification = await mapClaudeAgentMessageToChunks({
      type: 'system',
      subtype: 'task_notification',
      session_id: 'claude-session-workflow-full',
      uuid: 'workflow-notification-full',
      task_id: 'workflow-task-1',
      status: 'completed',
      output_file: '/tmp/workflow-output.json',
      summary: 'Workflow complete',
      usage: { total_tokens: 42, tool_uses: 7, duration_ms: 1234 },
      skip_transcript: false,
    } as unknown as SDKMessage, state)

    expect(notification.capturedCrewCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'toolu_workflow_full',
        tool: 'Workflow',
        workflow: expect.objectContaining({
          status: 'completed',
          lifecycle: [expect.objectContaining({
            type: 'task_notification',
            taskId: 'workflow-task-1',
            outputFile: '/tmp/workflow-output.json',
            summary: 'Workflow complete',
            usage: { totalTokens: 42, toolUses: 7, durationMs: 1234 },
          })],
        }),
      }),
    ])
    expect(notification.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-output-available',
        toolCallId: 'toolu_workflow_full',
        output: expect.objectContaining({
          result: expect.objectContaining({
            lifecycle: [expect.objectContaining({
              type: 'system',
              subtype: 'task_notification',
              task_id: 'workflow-task-1',
            })],
          }),
        }),
      }),
    ]))
  })

  it('maps parent-tool child stream events as ordinary chunks without subagent snapshots', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const chunks: Awaited<ReturnType<typeof mapClaudeAgentMessageToChunks>>['chunks'] = []

    for (let index = 0; index < 256; index += 1) {
      const result = await mapClaudeAgentMessageToChunks({
        type: 'stream_event',
        session_id: 'claude-session-1',
        parent_tool_use_id: 'toolu_parent_1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `${index} ` },
        },
      } as unknown as SDKMessage, state)

      chunks.push(...result.chunks)
    }

    const text = chunks
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => chunk.delta)
      .join('')

    expect(chunks.some(chunk => chunk.type === 'tool-output-available')).toBe(false)
    expect(text).toContain('255')
  })

  it('does not compact parent-tool child text into a preliminary subagent envelope', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const longText = `${'x'.repeat(70 * 1024)}tail`

    const result = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'claude-session-1',
      parent_tool_use_id: 'toolu_parent_1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: longText },
      },
    } as unknown as SDKMessage, state)

    const text = result.chunks
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => chunk.delta)
      .join('')

    expect(result.chunks.some(chunk => chunk.type === 'tool-output-available')).toBe(false)
    expect(text.length).toBe(longText.length)
    expect(text).toContain('tail')
  })

  it('closes streamed text and finishes the turn when Claude reports end_turn', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const chunks: import('ai').UIMessageChunk[] = []

    for (const message of [
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } } },
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_stop', index: 0 } },
      { type: 'stream_event', session_id: 's1', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } },
    ]) {
      const result = await mapClaudeAgentMessageToChunks(message as unknown as SDKMessage, state)
      chunks.push(...result.chunks)
    }

    expect(chunks).toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Done' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: 'stop' },
    ])
    assertValidProviderChunkSequence(chunks)
  })

  it('does not duplicate thinking parts when an assistant snapshot arrives after stream events', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const allChunks: import('ai').UIMessageChunk[] = []

    // Stream events: thinking block at index 0
    const streamResults = await Promise.all([
      mapClaudeAgentMessageToChunks({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } } as unknown as SDKMessage, state),
      mapClaudeAgentMessageToChunks({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } } } as unknown as SDKMessage, state),
      mapClaudeAgentMessageToChunks({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_stop', index: 0 } } as unknown as SDKMessage, state),
      // text block at index 1
      mapClaudeAgentMessageToChunks({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_start', index: 1, content_block: { type: 'text' } } } as unknown as SDKMessage, state),
      mapClaudeAgentMessageToChunks({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } } } as unknown as SDKMessage, state),
      mapClaudeAgentMessageToChunks({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_stop', index: 1 } } as unknown as SDKMessage, state),
    ])
    for (const r of streamResults) { allChunks.push(...r.chunks) }

    // Full assistant snapshot arrives (this previously caused a duplicate reasoning part)
    const snapshotResult = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 's1',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me think...' },
          { type: 'text', text: 'Hello' },
        ],
      },
    } as unknown as SDKMessage, state)
    allChunks.push(...snapshotResult.chunks)

    const reasoningStartCount = allChunks.filter(c => c.type === 'reasoning-start').length
    const reasoningEndCount = allChunks.filter(c => c.type === 'reasoning-end').length
    expect(reasoningStartCount).toBe(1)
    expect(reasoningEndCount).toBe(1)
  })

  it('does not replay streamed text before AskUserQuestion when an assistant snapshot arrives', async () => {
    const state = createClaudeAgentChunkMapperState('text-1')
    const allChunks: import('ai').UIMessageChunk[] = []

    const streamMessages = [
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Before question.' } } },
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_stop', index: 0 } },
      { type: 'stream_event', session_id: 's1', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_question_1', name: 'AskUserQuestion' } } },
    ]

    for (const message of streamMessages) {
      const result = await mapClaudeAgentMessageToChunks(message as unknown as SDKMessage, state)
      allChunks.push(...result.chunks)
    }

    const snapshotResult = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 's1',
      message: {
        content: [
          { type: 'text', text: 'Before question.' },
          {
            type: 'tool_use',
            id: 'toolu_question_1',
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  question: 'Which library should we use?',
                  header: 'Library',
                  options: [
                    { label: 'Zod', description: 'Use the existing schema library.' },
                    { label: 'TypeBox', description: 'Use the server schema library.' },
                  ],
                  multiSelect: false,
                },
              ],
            },
          },
        ],
      },
    } as unknown as SDKMessage, state)
    allChunks.push(...snapshotResult.chunks)

    expect(allChunks.filter(chunk =>
      chunk.type === 'text-delta' && chunk.delta === 'Before question.')).toHaveLength(1)
    expect(snapshotResult.chunks).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'toolu_question_1',
        toolName: 'AskUserQuestion',
        input: expect.objectContaining({
          apiName: 'AskUserQuestion',
        }),
      },
    ])
  })
})
