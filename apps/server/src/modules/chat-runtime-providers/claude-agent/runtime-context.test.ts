import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { shutdownInfra } from '../../../infra'
import { registerPluginSkill, resetPluginSkillRegistry } from '../../../plugins/skill-registry'
import { setAppPreferences } from '../../preferences/service'
import { resetNativeSkillProjectionTargets } from '../../skills/native-skill-projection'
import { resolveClaudeAgentRuntimeContext } from './runtime-context'

let tempHome: string | undefined

function createSkillPackage(root: string): string {
  const skillDir = join(root, 'runtime-demo-skill')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: runtime-demo',
    'description: Runtime demo skill',
    '---',
    '',
    '# Runtime Demo',
  ].join('\n'))
  return skillDir
}

function createBuiltinSkillPackage(root: string): string {
  const skillDir = join(root, 'builtin-demo')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: builtin-demo',
    'description: Builtin demo skill',
    '---',
    '',
    '# Builtin Demo',
  ].join('\n'))
  return skillDir
}

describe('claude agent runtime context native skill projection', () => {
  afterEach(() => {
    resetPluginSkillRegistry()
    resetNativeSkillProjectionTargets()
    shutdownInfra()
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true })
      tempHome = undefined
    }
  })

  it('projects plugin skills into the agent native skill root and .claude compatibility path', () => {
    tempHome = fs.mkdtempSync(join(tmpdir(), 'cradle-claude-runtime-context-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    try {
      const skillDir = createSkillPackage(tempHome)
      registerPluginSkill('@cradle/runtime-demo', {
        name: 'runtime-demo',
        description: 'Runtime demo skill',
        skillFile: join(skillDir, 'SKILL.md'),
      })

      const context = resolveClaudeAgentRuntimeContext('/tmp/workspace', 'agent-a')
      const agentHome = join(tempHome, '.cradle', 'agents', 'agent-a')
      const projection = join(agentHome, 'skills', 'cradle', 'plugin-runtime-demo', 'SKILL.md')
      const compatibilityProjection = join(agentHome, '.claude', 'skills', 'cradle', 'plugin-runtime-demo', 'SKILL.md')

      expect(context.agentHome).toBe(agentHome)
      expect(fs.existsSync(projection)).toBe(true)
      expect(fs.existsSync(compatibilityProjection)).toBe(true)
    }
    finally {
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
    }
  })

  it('does not project into the global Claude skill root without the feature flag', () => {
    tempHome = fs.mkdtempSync(join(tmpdir(), 'cradle-claude-global-context-default-home-'))
    const previousHome = process.env.HOME
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.HOME = tempHome
    process.env.CRADLE_DATA_DIR = tempHome

    try {
      const skillDir = createSkillPackage(tempHome)
      registerPluginSkill('@cradle/runtime-demo', {
        name: 'runtime-demo',
        description: 'Runtime demo skill',
        skillFile: join(skillDir, 'SKILL.md'),
      })

      const context = resolveClaudeAgentRuntimeContext('/tmp/workspace', null)
      const projection = join(tempHome, '.claude', 'skills', 'cradle', 'plugin-runtime-demo', 'SKILL.md')

      expect(context.agentHome).toBeNull()
      expect(fs.existsSync(projection)).toBe(false)
    }
    finally {
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('projects plugin and builtin skills into the global Claude skill root when enabled', async () => {
    tempHome = fs.mkdtempSync(join(tmpdir(), 'cradle-claude-global-context-home-'))
    const previousHome = process.env.HOME
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousBuiltinSkillsDir = process.env.CRADLE_BUILTIN_SKILLS_DIR
    process.env.HOME = tempHome
    process.env.CRADLE_DATA_DIR = tempHome

    try {
      const builtinRoot = join(tempHome, 'builtin-skills')
      createBuiltinSkillPackage(builtinRoot)
      process.env.CRADLE_BUILTIN_SKILLS_DIR = builtinRoot
      const skillDir = createSkillPackage(tempHome)
      registerPluginSkill('@cradle/runtime-demo', {
        name: 'runtime-demo',
        description: 'Runtime demo skill',
        skillFile: join(skillDir, 'SKILL.md'),
      })
      await setAppPreferences({
        featureFlags: {
          multiWorkspacePoc: false,
          localAuthForDangerousActions: false,
          continueBlockedCodexGoals: false,
          blockCodexAppServerLogInserts: false,
          nativeProviderSkillProjection: true,
        },
      })

      const context = resolveClaudeAgentRuntimeContext('/tmp/workspace', null)
      const projection = join(tempHome, '.claude', 'skills', 'cradle', 'plugin-runtime-demo', 'SKILL.md')
      const builtinProjection = join(tempHome, '.claude', 'skills', 'cradle', 'builtin-demo', 'SKILL.md')

      expect(context.agentHome).toBeNull()
      expect(fs.existsSync(projection)).toBe(true)
      expect(fs.existsSync(builtinProjection)).toBe(true)
    }
    finally {
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousBuiltinSkillsDir === undefined) {
        delete process.env.CRADLE_BUILTIN_SKILLS_DIR
      }
      else {
        process.env.CRADLE_BUILTIN_SKILLS_DIR = previousBuiltinSkillsDir
      }
    }
  })
})
