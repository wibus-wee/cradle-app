import { afterEach, describe, expect, it, vi } from 'vitest'

import { liveRuntimeSessionRegistry } from '../../chat-runtime/runtime-live-session-registry'
import { ClaudeAgentProvider } from './provider'
import {
  createPendingQuery,
  createProfile,
  createRuntimeSession,
  createUserMessage,
} from './test-kit'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  getSubagentMessages: vi.fn(),
  listSubagents: vi.fn(),
  renameSession: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => sdkMocks)

describe.sequential('claudeAgentLiveSettings', () => {
  afterEach(() => {
    vi.clearAllMocks()
    liveRuntimeSessionRegistry.clear()
  })

  it('registers active queries for idle runtime settings propagation', async () => {
    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-live-registry',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Keep query alive'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'plan' },
      },
    })
    const pendingNext = stream.next()

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const liveRuntimeSession = liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)
    expect(liveRuntimeSession).toBeDefined()
    expect(liveRuntimeSession?.readRuntimeSession()).toBe(runtimeSession)

    await liveRuntimeSession!.updateRuntimeSettings({
      permissionMode: 'bypassPermissions',
    })

    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('bypassPermissions')

    activeQuery.close()
    await pendingNext
    expect(liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)).toBeUndefined()
  })
})
