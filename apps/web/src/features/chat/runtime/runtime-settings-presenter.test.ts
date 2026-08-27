import { describe, expect, it } from 'vitest'

import {
  buildExitPlanModePatch,
  buildPlanModeTogglePatch,
  isPlanRuntimeSettings,
  readRunRuntimeSettingsPatch,
  readRuntimeSettingsIconKey,
  supportsPlanModeToggle,
} from './runtime-settings-presenter'

describe('runtime-settings-presenter', () => {
  it('detects plan mode from native claude permissionMode', () => {
    expect(isPlanRuntimeSettings({ permissionMode: 'plan' })).toBe(true)
    expect(isPlanRuntimeSettings({ permissionMode: 'bypassPermissions' })).toBe(false)
  })

  it('detects plan mode from codex interactionMode', () => {
    expect(isPlanRuntimeSettings({ interactionMode: 'plan' })).toBe(true)
    expect(isPlanRuntimeSettings({ interactionMode: 'default' })).toBe(false)
  })

  it('builds claude-agent plan toggle patches', () => {
    expect(buildPlanModeTogglePatch('claude-agent', { permissionMode: 'bypassPermissions' })).toEqual({
      permissionMode: 'plan',
    })
    expect(buildPlanModeTogglePatch('claude-agent', { permissionMode: 'plan' })).toEqual({
      permissionMode: 'bypassPermissions',
    })
  })

  it('builds codex plan toggle patches', () => {
    expect(buildPlanModeTogglePatch('codex', { interactionMode: 'default' })).toEqual({
      interactionMode: 'plan',
    })
    expect(buildPlanModeTogglePatch('codex', { interactionMode: 'plan' })).toEqual({
      interactionMode: 'default',
    })
  })

  it('builds exit-plan patches per runtime', () => {
    expect(buildExitPlanModePatch('claude-agent')).toEqual({ permissionMode: 'bypassPermissions' })
    expect(buildExitPlanModePatch('codex')).toEqual({ interactionMode: 'default' })
  })

  it('supports plan toggle only for runtimes with plan semantics', () => {
    expect(supportsPlanModeToggle('claude-agent')).toBe(true)
    expect(supportsPlanModeToggle('codex')).toBe(true)
    expect(supportsPlanModeToggle('standard')).toBe(false)
    expect(buildPlanModeTogglePatch('standard', {})).toBeNull()
  })

  it('strips claudeAgent from run-time runtimeSettings payloads', () => {
    expect(readRunRuntimeSettingsPatch({
      permissionMode: 'plan',
      claudeAgent: { modelAliases: { haiku: 'x', sonnet: 'y', opus: 'z' } },
    })).toEqual({ permissionMode: 'plan' })
  })

  it('uses a distinct icon for automatic approval review', () => {
    expect(readRuntimeSettingsIconKey({ accessMode: 'approve-for-me' })).toBe('auto-approval')
    expect(readRuntimeSettingsIconKey({ accessMode: 'approval-required' })).toBe('approval')
    expect(readRuntimeSettingsIconKey({ accessMode: 'full-access' })).toBe('full-access')
  })
})
