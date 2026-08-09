import { describe, expect, it } from 'vitest'

import {
  readClaudeAgentAllowDangerouslySkipPermissions,
  readClaudeAgentPermissionMode,
} from './runtime-settings'

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
