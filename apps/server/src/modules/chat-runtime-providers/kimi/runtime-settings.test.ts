import { describe, expect, it } from 'vitest'

import { projectKimiRuntimeSettings } from './runtime-settings'

describe('projectKimiRuntimeSettings', () => {
  it.each([
    ['approval-required', 'manual'],
    ['approve-for-me', 'auto'],
    ['full-access', 'yolo'],
  ] as const)('maps %s access to Kimi %s permission mode', (accessMode, permissionMode) => {
    expect(projectKimiRuntimeSettings({ accessMode, interactionMode: 'default' })).toEqual({
      permissionMode,
      planMode: false,
    })
  })

  it('projects plan mode independently from access', () => {
    expect(projectKimiRuntimeSettings({
      accessMode: 'approve-for-me',
      interactionMode: 'plan',
    })).toEqual({ permissionMode: 'auto', planMode: true })
  })
})
