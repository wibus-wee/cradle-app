import { describe, expect, it } from 'vitest'

import type { RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { readClaudeAgentWorkflowExecutions } from './state-projector'
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
})
