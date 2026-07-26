import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClaudeAgentProvider } from './provider'
import { createProfile, createResumedRuntimeSession } from './test-kit'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  getSubagentMessages: vi.fn(),
  listSubagents: vi.fn(),
  renameSession: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => sdkMocks)

describe('claudeAgentSessionArtifacts', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('lists Claude Agent subagent provider threads from SDK transcripts', async () => {
    sdkMocks.listSubagents.mockResolvedValue(['agent-a'])
    sdkMocks.getSubagentMessages.mockResolvedValue([
      {
        type: 'assistant',
        uuid: 'msg-subagent-1',
        session_id: 'claude-session-1',
        parent_tool_use_id: 'call_agent_1',
        timestamp: '2026-06-24T05:26:56.810Z',
        subagent_type: 'general-purpose',
        task_description: 'Inspect the runtime logs',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Subagent report' }],
        },
      },
    ])

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(
      provider.listProviderThreads({
        runtimeSession: createResumedRuntimeSession(),
        profile: createProfile(),
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toMatchObject({
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-session-1',
      threads: [
        {
          id: 'call_agent_1',
          providerSessionTreeId: 'claude-session-1',
          forkedFromId: 'call_agent_1',
          preview: 'Subagent report',
          sourceKind: 'subAgent',
          source: expect.objectContaining({
            agentId: 'agent-a',
            parentToolUseId: 'call_agent_1',
          }),
          agentNickname: 'general-purpose',
          agentRole: 'Inspect the runtime logs',
          modelProvider: 'claude-sonnet-4-20250514',
        },
      ],
    })
    expect(sdkMocks.listSubagents).toHaveBeenCalledWith('claude-session-1', {
      dir: '/tmp/cradle-workspace',
    })
    expect(sdkMocks.getSubagentMessages).toHaveBeenCalledWith('claude-session-1', 'agent-a', {
      dir: '/tmp/cradle-workspace',
    })
  })
})
