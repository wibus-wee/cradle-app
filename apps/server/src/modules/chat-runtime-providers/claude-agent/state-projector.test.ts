import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import type { RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import {
  projectClaudeAgentCrewUiSlotState,
  projectClaudeAgentUsageUiSlotState,
  readClaudeAgentWorkflowExecutions,
  writeClaudeAgentCrewCall,
  writeClaudeAgentModelSwitchSnapshot,
  writeClaudeAgentResultSnapshot,
  writeClaudeAgentTaskActivity,
  writeClaudeAgentWorkflowExecution,
} from './state-projector'
import {
  createClaudeWorkflowExecutionRecord,
  mergeClaudeWorkflowExecutionRecord,
} from './workflow'

function createRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: null,
    runtimeKind: 'claude-agent',
    providerSessionId: null,
    providerStateSnapshot: JSON.stringify({ models: { currentModelId: null } }),
  }
}

describe('claude result usage projection', () => {
  it('preserves result correlation, native queue count, and explained estimated costs', () => {
    const runtimeSession = createRuntimeSession()
    writeClaudeAgentResultSnapshot(runtimeSession, {
      type: 'result',
      subtype: 'success',
      duration_ms: 100,
      duration_api_ms: 80,
      is_error: false,
      num_turns: 1,
      result: 'done',
      stop_reason: 'end_turn',
      total_cost_usd: 0.123,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: null,
        service_tier: null,
      },
      modelUsage: {
        'claude-alias': {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.123,
          contextWindow: 200_000,
          maxOutputTokens: 32_000,
          canonicalModel: 'claude-sonnet-4-6',
          provider: 'bedrock',
          costBasis: 'managed',
        },
      },
      permission_denials: [],
      queued_turn_count: 2,
      user_message_uuid: 'user-message-1',
      uuid: 'result-1',
      session_id: 'claude-session-1',
    } as unknown as SDKResultMessage, 123)

    expect(projectClaudeAgentUsageUiSlotState(runtimeSession)).toMatchObject({
      estimatedCostUsd: 0.123,
      queuedTurnCount: 2,
      resultMessageId: 'result-1',
      correlatedUserMessageId: 'user-message-1',
      modelCosts: [{
        modelId: 'claude-alias',
        canonicalModelId: 'claude-sonnet-4-6',
        provider: 'bedrock',
        costUsd: 0.123,
        costBasis: 'managed',
      }],
      updatedAt: 123,
    })
  })

  it('projects exact post-switch cache cost facts', () => {
    const runtimeSession = createRuntimeSession()
    writeClaudeAgentModelSwitchSnapshot(runtimeSession, {
      hook_event_name: 'PostModelSwitch',
      session_id: 'claude-session-1',
      transcript_path: '/tmp/claude-session-1.jsonl',
      cwd: '/tmp',
      from_model: 'claude-sonnet-4-6',
      to_model: 'claude-opus-4-6',
      requested_model: 'opus',
      source: 'sdk',
      context_tokens: 42_000,
      prompt_cache_warm: true,
      cache_ttl: '1h',
      estimated_cache_write_usd: 0.25,
      pricing: 'configured',
    }, 456)

    expect(projectClaudeAgentUsageUiSlotState(runtimeSession)).toMatchObject({
      lastModelSwitch: {
        fromModelId: 'claude-sonnet-4-6',
        toModelId: 'claude-opus-4-6',
        source: 'sdk',
        contextTokens: 42_000,
        promptCacheWarm: true,
        cacheTtl: '1h',
        estimatedCacheWriteUsd: 0.25,
        pricing: 'configured',
        updatedAt: 456,
      },
    })
  })

  it('does not invent a pricing basis for older model usage envelopes', () => {
    const runtimeSession = createRuntimeSession()
    writeClaudeAgentResultSnapshot(runtimeSession, {
      type: 'result',
      subtype: 'success',
      uuid: 'result-legacy',
      user_message_uuid: 'user-message-legacy',
      queued_turn_count: 0,
      total_cost_usd: 0.01,
      session_id: 'claude-session-1',
      modelUsage: {
        'claude-legacy': {
          costUSD: 0.01,
        },
      },
    } as unknown as SDKResultMessage, 789)

    expect(projectClaudeAgentUsageUiSlotState(runtimeSession)?.modelCosts).toEqual([{
      modelId: 'claude-legacy',
      canonicalModelId: null,
      provider: null,
      costUsd: 0.01,
      costBasis: 'unknown',
    }])
  })
})

describe('claude crew retry projection', () => {
  it('preserves retry details and exposes retrying agent state', () => {
    const runtimeSession = createRuntimeSession()
    writeClaudeAgentCrewCall(runtimeSession, {
      id: 'toolu-agent-1',
      agentId: 'agent-1',
      tool: 'Agent',
      prompt: 'Inspect the protocol',
      description: 'Protocol audit',
      subagentType: 'Explore',
      model: null,
      reasoningEffort: null,
      tools: [],
      outputFile: null,
      runInBackground: false,
      status: 'running',
      retry: {
        agentId: 'agent-1',
        attempt: 2,
        maxRetries: 4,
        retryDelayMs: 8_000,
        errorStatus: 529,
        errorCategory: 'overloaded',
      },
      startedAt: 100,
      completedAt: null,
    })

    expect(projectClaudeAgentCrewUiSlotState(runtimeSession)).toMatchObject({
      activeCount: 1,
      calls: [{
        id: 'toolu-agent-1',
        status: 'running',
        retry: {
          agentId: 'agent-1',
          attempt: 2,
          maxRetries: 4,
          retryDelayMs: 8_000,
          errorStatus: 529,
          errorCategory: 'overloaded',
        },
      }],
      agents: [{ threadId: 'toolu-agent-1', status: 'retrying' }],
    })
  })
})

describe('claude Workflow provider snapshot', () => {
  it('merges complete input, output, lifecycle, and raw fields without losing prior data', () => {
    const runtimeSession = createRuntimeSession()
    const initial = createClaudeWorkflowExecutionRecord({
      toolCallId: 'toolu_workflow_1',
      input: {
        script: 'export const meta = { name: \'research\' }',
        args: { question: 'What changed?' },
        scriptPath: '/tmp/research.js',
      },
      startedAt: 100,
      completedAt: null,
    })
    const completed = createClaudeWorkflowExecutionRecord({
      toolCallId: 'toolu_workflow_1',
      output: {
        status: 'async_launched',
        taskId: 'workflow-task-1',
        taskType: 'local_workflow',
        workflowName: 'research',
        runId: 'wf_run_1',
        summary: 'Workflow complete',
        transcriptDir: '/tmp/transcripts/workflow-task-1',
      },
      lifecycle: {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'workflow-task-1',
        status: 'completed',
        output_file: '/tmp/workflow-output.json',
        summary: 'Workflow complete',
        usage: { total_tokens: 42, tool_uses: 7, duration_ms: 1234 },
        uuid: '00000000-0000-4000-8000-000000000001',
        session_id: 'claude-session-1',
      },
      status: 'completed',
      startedAt: 0,
      completedAt: 200,
    })

    const first = mergeClaudeWorkflowExecutionRecord(initial, completed)
    const second = mergeClaudeWorkflowExecutionRecord(first, createClaudeWorkflowExecutionRecord({
      toolCallId: 'toolu_workflow_1',
      lifecycle: {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'workflow-task-1',
        tool_use_id: 'toolu_workflow_1',
        description: 'Running worker',
        subagent_type: 'Explore',
        usage: { total_tokens: 24, tool_uses: 3, duration_ms: 500 },
        last_tool_name: 'Read',
        summary: 'Worker reading files',
        uuid: '00000000-0000-4000-8000-000000000002',
        session_id: 'claude-session-1',
      },
      status: 'running',
      startedAt: 0,
      completedAt: null,
    }))

    expect(second.input.script).toContain('research')
    expect(second.input.args).toEqual({ question: 'What changed?' })
    expect(second.output).toEqual(expect.objectContaining({
      taskId: 'workflow-task-1',
      runId: 'wf_run_1',
      transcriptDir: '/tmp/transcripts/workflow-task-1',
    }))
    expect(second.lifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task_notification', status: 'completed' }),
      expect.objectContaining({ type: 'task_progress', lastToolName: 'Read' }),
    ]))
    expect(second.completedAt).toBe(200)

    const snapshot = JSON.stringify({
      models: { currentModelId: null },
      claudeAgent: { workflowExecutions: [second] },
    })
    runtimeSession.providerStateSnapshot = snapshot

    expect(readClaudeAgentWorkflowExecutions(runtimeSession)).toEqual([second])
  })

  it('reads old snapshots without Workflow executions as empty', () => {
    const runtimeSession = createRuntimeSession()
    expect(readClaudeAgentWorkflowExecutions(runtimeSession)).toEqual([])
  })

  it('bounds recent activity snapshots while retaining running work', () => {
    const runtimeSession = createRuntimeSession()
    for (let index = 0; index < 34; index += 1) {
      writeClaudeAgentCrewCall(runtimeSession, {
        id: `crew-${index}`,
        agentId: null,
        tool: 'Agent',
        prompt: index === 33 ? 'x'.repeat(2_100) : `crew prompt ${index}`,
        description: null,
        subagentType: null,
        model: null,
        reasoningEffort: null,
        tools: [],
        outputFile: null,
        runInBackground: false,
        status: 'completed',
        startedAt: index,
        completedAt: index,
      })
    }
    writeClaudeAgentCrewCall(runtimeSession, {
      id: 'crew-running',
      agentId: null,
      tool: 'Agent',
      prompt: 'still running',
      description: null,
      subagentType: null,
      model: null,
      reasoningEffort: null,
      tools: [],
      outputFile: null,
      runInBackground: true,
      status: 'running',
      startedAt: 0,
      completedAt: null,
    })

    for (let index = 0; index < 14; index += 1) {
      writeClaudeAgentWorkflowExecution(runtimeSession, createClaudeWorkflowExecutionRecord({
        toolCallId: `workflow-${index}`,
        status: 'completed',
        startedAt: index,
      }))
    }
    writeClaudeAgentWorkflowExecution(runtimeSession, createClaudeWorkflowExecutionRecord({
      toolCallId: 'workflow-running',
      status: 'running',
      startedAt: 0,
    }))

    for (let index = 0; index < 30; index += 1) {
      writeClaudeAgentTaskActivity(runtimeSession, {
        id: `task-${index}`,
        label: `Task ${index}`,
        status: 'completed',
        startedAt: index,
        completedAt: index,
      })
    }
    writeClaudeAgentTaskActivity(runtimeSession, {
      id: 'task-running',
      label: 'Still running',
      status: 'running',
      startedAt: 0,
      completedAt: null,
    })

    const claudeAgent = JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent as {
      crewCalls: Array<{ id: string, prompt: string | null }>
      workflowExecutions: Array<{ toolCallId: string }>
      taskActivity: Array<{ id: string }>
    }
    expect(claudeAgent.crewCalls).toHaveLength(25)
    expect(claudeAgent.crewCalls.map(call => call.id)).toEqual(expect.arrayContaining(['crew-running', 'crew-33']))
    expect(claudeAgent.crewCalls.find(call => call.id === 'crew-33')?.prompt).toHaveLength(2_000)
    expect(claudeAgent.workflowExecutions).toHaveLength(13)
    expect(claudeAgent.workflowExecutions.map(execution => execution.toolCallId)).toContain('workflow-running')
    expect(claudeAgent.taskActivity).toHaveLength(25)
    expect(claudeAgent.taskActivity.map(item => item.id)).toContain('task-running')
  })

  it('caps workflow lifecycle snapshots at twenty entries', () => {
    let execution = createClaudeWorkflowExecutionRecord({ toolCallId: 'workflow-lifecycle-limit' })
    for (let index = 0; index < 25; index += 1) {
      execution = mergeClaudeWorkflowExecutionRecord(execution, createClaudeWorkflowExecutionRecord({
        toolCallId: 'workflow-lifecycle-limit',
        lifecycle: {
          type: 'system',
          subtype: 'task_progress',
          task_id: 'workflow-task-limit',
          description: `Progress ${index}`,
          usage: { total_tokens: index, tool_uses: index, duration_ms: index },
          uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          session_id: 'claude-session-lifecycle-limit',
        },
      }))
    }

    expect(execution.lifecycle).toHaveLength(20)
    expect(execution.rawLifecycle).toHaveLength(20)
    expect(execution.lifecycle[0]?.description).toBe('Progress 5')
  })
})
