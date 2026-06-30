// Tests Jarvis runtime provider integration behavior.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { RuntimeProviderTargetProfile } from '../src/modules/chat-runtime/runtime-provider-types'
import { SystemAgentProvider } from '../src/modules/chat-runtime-providers/system-agent/provider'

const jarCoreMocks = vi.hoisted(() => ({
  defaultRuntimeConfig: vi.fn(async (options: unknown) => ({ options })),
  executeIngressCommand: vi.fn(async ({ command }: {
    command: { execution: { onEvent: (event: { type: string }) => void } }
  }) => {
    command.execution.onEvent({ type: 'agent_end' })
    return { kind: 'message' as const, model: 'gpt-5', usage: null }
  }),
}))

vi.mock('@hijarvis/core', () => jarCoreMocks)

vi.mock('../src/modules/model-registry/model-info-registry', () => {
  const ModelsDevModelSchema = z.object({ id: z.string() }).passthrough()
  return {
    ModelsDevModelSchema,
    lookupModelRaw: vi.fn(async () => null),
    lookupModelRawExact: vi.fn(async () => null),
  }
})

describe('systemAgentProvider', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('injects chat session and workspace env for Jarvis shell commands', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-jarvis-provider-'))
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    mkdirSync(join(dataDir, 'preferences'), { recursive: true })
    writeFileSync(join(dataDir, 'preferences', 'jarvis.json'), JSON.stringify({
      profileId: 'profile-jarvis',
      model: 'gpt-5',
      thinkingLevel: 'medium',
    }), 'utf8')

    try {
      const provider = new SystemAgentProvider({
        readSecret: () => 'secret',
        resolveSkillPaths: () => [],
      })
      const profile: RuntimeProviderTargetProfile = {
        id: 'profile-jarvis',
        name: 'Jarvis',
        providerKind: 'openai-compatible',
        enabled: true,
        configJson: '{}',
        credentialRef: null,
        customModels: '[]',
        iconSlug: null,
        providerTargetKind: 'manual',
        providerTargetId: 'profile-jarvis',
      }
      const message: UIMessage = {
        id: 'message-jarvis',
        role: 'user',
        parts: [{ type: 'text', text: 'Create an issue' }],
      }

      for await (const _chunk of provider.streamTurn({
        runId: 'run-jarvis-provider',
        runtimeSession: {
          id: 'chat-session-jarvis',
          chatSessionId: 'chat-session-jarvis',
          providerTargetId: 'profile-jarvis',
          runtimeKind: 'jar-core',
          providerSessionId: null,
          providerStateSnapshot: null,
        },
        profile,
        message,
        workspaceId: 'workspace-cradle',
      })) {
        // The mock completes through an agent_end event without yielding chunks.
      }

      expect(jarCoreMocks.defaultRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({
        extraShellEnv: {
          CRADLE_CHAT_SESSION_ID: 'chat-session-jarvis',
          CRADLE_WORKSPACE_ID: 'workspace-cradle',
        },
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
