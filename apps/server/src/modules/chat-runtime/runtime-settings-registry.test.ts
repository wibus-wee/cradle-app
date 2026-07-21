import { describe, expect, it } from 'vitest'

import {
  migrateLegacyClaudeAgentRuntimeSettings,
  readRuntimeSettingsDefaults,
  readRuntimeSettingsSchema,
  readSessionRuntimeSettingsFromConfig,
  resolveRuntimeSettingsEntry,
} from './runtime-settings-registry'

describe('runtime-settings-registry', () => {
  it('exposes claude-agent as a 1D permissionMode schema', () => {
    const schema = readRuntimeSettingsSchema('claude-agent')
    expect(schema).toMatchObject({
      required: ['permissionMode'],
      properties: {
        permissionMode: {
          enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        },
      },
    })
  })

  it('normalizes claude-agent settings to permissionMode only', () => {
    const entry = resolveRuntimeSettingsEntry('claude-agent')
    expect(entry?.normalize({ permissionMode: 'plan' })).toEqual({ permissionMode: 'plan' })
    expect(entry?.normalize({ accessMode: 'full-access', interactionMode: 'plan' })).toEqual({})
    expect(entry?.defaults).toEqual({ permissionMode: 'bypassPermissions' })
  })

  it('migrates legacy claude-agent 2D session settings on read', () => {
    expect(migrateLegacyClaudeAgentRuntimeSettings({
      accessMode: 'full-access',
      interactionMode: 'plan',
    })).toEqual({ permissionMode: 'plan' })
    expect(migrateLegacyClaudeAgentRuntimeSettings({
      accessMode: 'approval-required',
      interactionMode: 'default',
    })).toEqual({ permissionMode: 'default' })
    expect(migrateLegacyClaudeAgentRuntimeSettings({
      accessMode: 'full-access',
      interactionMode: 'default',
    })).toEqual({ permissionMode: 'bypassPermissions' })
    expect(readSessionRuntimeSettingsFromConfig('claude-agent', JSON.stringify({
      runtimeSettings: { accessMode: 'full-access', interactionMode: 'plan' },
    }))).toEqual({ permissionMode: 'plan' })
  })

  it('merges codex 2D runtime settings independently', () => {
    const entry = resolveRuntimeSettingsEntry('codex')
    expect(readRuntimeSettingsDefaults('codex')).toEqual({
      accessMode: 'full-access',
      interactionMode: 'default',
    })
    expect(entry?.merge(
      { accessMode: 'full-access', interactionMode: 'default' },
      { interactionMode: 'plan' },
    )).toEqual({
      accessMode: 'full-access',
      interactionMode: 'plan',
    })
  })

  it('uses the same 2D runtime settings contract for Kimi', () => {
    const entry = resolveRuntimeSettingsEntry('kimi')
    expect(readRuntimeSettingsDefaults('kimi')).toEqual({
      accessMode: 'full-access',
      interactionMode: 'default',
    })
    expect(entry?.normalize({
      accessMode: 'approval-required',
      interactionMode: 'plan',
    })).toEqual({
      accessMode: 'approval-required',
      interactionMode: 'plan',
    })
  })
})
