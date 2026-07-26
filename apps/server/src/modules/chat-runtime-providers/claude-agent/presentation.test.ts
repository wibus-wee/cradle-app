import { describe, expect, it } from 'vitest'

import { ClaudeAgentProvider } from './provider'
import { createProfile, createRuntimeSession } from './test-kit'

describe('claudeAgentPresentation', () => {
  it('returns null context usage when no Claude Agent query is active', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(
      provider.getContextUsage({
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toBeNull()
  })
})
