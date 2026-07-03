import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { registerPluginSkill, resetPluginSkillRegistry } from '../../plugins/skill-registry'
import { registerRuntime, resolveRuntimeSkillPaths, RuntimeRegistry } from './chat-runtime-provider-registry'
import type { ChatRuntime, ChatRuntimeCapabilities } from './runtime-provider-types'

let tempDir: string | undefined

function createTempDir(): string {
  tempDir = fs.mkdtempSync(join(tmpdir(), 'cradle-runtime-skill-paths-'))
  return tempDir
}

function createSkillPackage(root: string): string {
  const skillDir = join(root, 'plugin-extra-root')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: plugin-extra-root',
    'description: Plugin extra root',
    '---',
    '',
    '# Plugin Extra Root',
  ].join('\n'))
  return skillDir
}

describe('runtime skill path resolution', () => {
  afterEach(() => {
    resetPluginSkillRegistry()
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('includes registered plugin skill packages and invalidates cached paths when registrations change', () => {
    const root = createTempDir()
    const workspacePath = join(root, 'workspace')
    const skillDir = createSkillPackage(root)

    expect(resolveRuntimeSkillPaths(workspacePath)).not.toContain(skillDir)

    registerPluginSkill('@cradle/plugin-extra-root', {
      name: 'plugin-extra-root',
      description: 'Plugin extra root',
      skillFile: join(skillDir, 'SKILL.md'),
    })
    expect(resolveRuntimeSkillPaths(workspacePath)).toContain(skillDir)

    resetPluginSkillRegistry()
    expect(resolveRuntimeSkillPaths(workspacePath)).not.toContain(skillDir)
  })
})

function failTestRuntimeProfile(): never {
  throw new Error('test runtime requires a provider target profile')
}

describe('runtime capability validation', () => {
  it('registers a new runtime through the core ChatRuntime contract without Codex app-server hooks', () => {
    const registry = new RuntimeRegistry()
    const runtime = {
      runtimeKind: 'test-runtime',
      metadata: {
        label: 'Test Runtime',
        providerKinds: ['openai-compatible'],
      },
      capabilities: {
        supportsSteerTurn: false,
        supportsShellExecution: false,
        supportsLastTurnRollback: false,
        supportsRuntimeSettings: false,
        supportsUiSlotStates: false,
        supportsDynamicCapabilities: false,
        supportsTitleGeneration: false,
        sessionModelSwitch: 'in-session',
      },
      startChatSession: async input => ({
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: input.profile?.providerTargetId ?? failTestRuntimeProfile(),
        runtimeKind: 'test-runtime',
        providerSessionId: null,
        providerStateSnapshot: JSON.stringify({
          models: { currentModelId: input.modelId ?? null },
        }),
      }),
      resumeChatSession: async input => input.runtimeSession,
      streamTurn: async function* () {},
      cancelTurn: async () => undefined,
    } satisfies ChatRuntime

    registry.register(runtime)

    expect(registry.get('test-runtime')).toBe(runtime)
    expect(registry.list()).toContainEqual(
      expect.objectContaining({
        runtimeKind: 'test-runtime',
        label: 'Test Runtime',
        providerKinds: ['openai-compatible'],
      })
    )
  })

  it('requires rollbackLastTurn when last-turn rollback support is declared', () => {
    const capabilities = {
      supportsSteerTurn: false,
      supportsShellExecution: false,
      supportsLastTurnRollback: true,
      supportsRuntimeSettings: false,
      supportsUiSlotStates: false,
      supportsDynamicCapabilities: false,
      supportsTitleGeneration: false,
      sessionModelSwitch: 'in-session',
    } satisfies ChatRuntimeCapabilities
    const runtime = {
      runtimeKind: 'test-rollback-runtime',
      metadata: {
        label: 'Test Rollback Runtime',
        providerKinds: ['openai-compatible'],
      },
      capabilities,
      startChatSession: async () => {
        throw new Error('not used')
      },
      resumeChatSession: async () => {
        throw new Error('not used')
      },
      streamTurn: async function* () {},
      cancelTurn: async () => undefined,
    } as ChatRuntime

    expect(() => registerRuntime(runtime)).toThrow(
      'Runtime test-rollback-runtime declares rollbackLastTurn support but does not implement the hook.'
    )
  })
})
