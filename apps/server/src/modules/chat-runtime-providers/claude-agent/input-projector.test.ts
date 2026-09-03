import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { projectClaudeAgentInput } from './input-projector'
import {
  readClaudeAgentAllowDangerouslySkipPermissions,
  readClaudeAgentPermissionMode,
} from './runtime-settings'

let skillFixtureRoot: string | undefined

afterEach(() => {
  if (skillFixtureRoot) {
    rmSync(skillFixtureRoot, { recursive: true, force: true })
    skillFixtureRoot = undefined
  }
})

describe('projectClaudeAgentInput', () => {
  it('inlines an explicitly selected Cradle skill with the user prompt', () => {
    skillFixtureRoot = mkdtempSync(join(tmpdir(), 'cradle-claude-skill-input-'))
    const skillDir = join(skillFixtureRoot, 'release-verdict')
    mkdirSync(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: release-verdict',
      'description: Apply the release policy.',
      '---',
      '',
      'Require marker CRADLE_SKILL_RELEASE_VERDICT_7F3A.',
    ].join('\n'))

    expect(projectClaudeAgentInput({
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Give a release verdict.' },
        {
          type: 'data-cradle-skill',
          data: {
            type: 'data-cradle-skill',
            name: 'release-verdict',
            path: skillDir,
            scope: 'workspace',
            description: 'Apply the release policy.',
          },
        },
      ],
    }, 'Claude Agent provider')).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('CRADLE_SKILL_RELEASE_VERDICT_7F3A'),
      },
      { type: 'text', text: 'Give a release verdict.' },
    ])
  })
})

describe('readClaudeAgentPermissionMode', () => {
  it('maps plan permission mode to SDK plan permission mode', () => {
    expect(readClaudeAgentPermissionMode({
      permissionMode: 'plan',
    })).toBe('plan')
  })

  it('maps default permission mode to SDK default', () => {
    expect(readClaudeAgentPermissionMode({
      permissionMode: 'default',
    })).toBe('default')
  })

  it('falls back to default permissions when unset or unrecognized', () => {
    expect(readClaudeAgentPermissionMode({})).toBe('default')
    expect(readClaudeAgentPermissionMode({ permissionMode: 'dontAsk' })).toBe('default')
  })
})

describe('readClaudeAgentAllowDangerouslySkipPermissions', () => {
  it.each(['default', 'acceptEdits', 'plan'] as const)(
    'does not enable SDK permission skipping in %s mode',
    (permissionMode) => {
      expect(readClaudeAgentAllowDangerouslySkipPermissions({ permissionMode })).toBe(false)
    },
  )

  it('does not enable SDK permission skipping when the mode is unset', () => {
    expect(readClaudeAgentAllowDangerouslySkipPermissions({})).toBe(false)
  })

  it('keeps SDK permission skip in bypass permission mode', () => {
    expect(readClaudeAgentAllowDangerouslySkipPermissions({
      permissionMode: 'bypassPermissions',
    })).toBe(true)
  })
})
