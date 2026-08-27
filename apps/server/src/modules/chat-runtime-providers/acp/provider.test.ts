import { RequestError } from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import type { AcpConnectionManager } from './connection-manager'
import { AcpChatProvider } from './provider'

const profile: RuntimeProviderTargetProfile = {
  id: 'acp-profile',
  name: 'ACP profile',
  providerKind: 'universal',
  enabled: true,
  configJson: JSON.stringify({
    distributionType: 'command',
    cmd: '/fake/acp-agent',
    args: [],
    env: {},
  }),
  credentialRef: null,
  customModels: '[]',
  iconSlug: null,
  providerTargetKind: 'manual',
  providerTargetId: 'acp-profile',
}

const runtimeSession: RuntimeSession = {
  id: 'chat-session',
  chatSessionId: 'chat-session',
  providerTargetId: 'acp-profile',
  runtimeKind: 'acp-chat',
  providerSessionId: 'native-session',
  providerStateSnapshot: null,
}

function createRuntime(resumeError: Error) {
  return {
    isConnected: () => true,
    supportsResumeSession: () => true,
    supportsLoadSession: () => true,
    resumeSession: vi.fn(async () => { throw resumeError }),
    loadSession: vi.fn(async () => ({ modes: null, configOptions: [] })),
    setSessionModel: vi.fn(),
  }
}

describe('acpChatProvider resume fallback', () => {
  it('falls back from resume to load only for an exact method-not-found code', async () => {
    const runtime = createRuntime(new ProviderRuntimeError(
      ProviderErrors.requestFailed('acp-chat', 'session/resume', 'failed'),
      { cause: new RequestError(-32601, 'opaque') },
    ))
    const provider = new AcpChatProvider({ runtime: runtime as unknown as AcpConnectionManager })

    await expect(provider.resumeChatSession({
      runtimeSession,
      profile,
      workspacePath: '/workspace',
    })).resolves.toMatchObject({ providerSessionId: 'native-session' })
    expect(runtime.loadSession).toHaveBeenCalledOnce()
  })

  it('preserves auth-required failures instead of creating another native session', async () => {
    const error = new ProviderRuntimeError(
      ProviderErrors.authRequired('acp-chat', []),
      { cause: new RequestError(-32000, 'opaque') },
    )
    const runtime = createRuntime(error)
    const provider = new AcpChatProvider({ runtime: runtime as unknown as AcpConnectionManager })

    await expect(provider.resumeChatSession({
      runtimeSession,
      profile,
      workspacePath: '/workspace',
    })).rejects.toBe(error)
    expect(runtime.loadSession).not.toHaveBeenCalled()
  })
})
