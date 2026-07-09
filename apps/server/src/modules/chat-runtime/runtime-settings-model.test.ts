import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { sessionRuntimeSettingsPatchSchema } from './runtime-settings-model'

describe('sessionRuntimeSettingsPatchSchema', () => {
  it('declares known runtime setting properties for OpenAPI consumers', () => {
    expect(Object.keys(sessionRuntimeSettingsPatchSchema.properties)).toEqual([
      'permissionMode',
      'accessMode',
      'interactionMode',
      'claudeAgent',
    ])
  })

  it('accepts provider-native runtime settings', () => {
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      permissionMode: 'plan',
      accessMode: 'full-access',
      interactionMode: 'default',
      providerNativeFlag: true,
    })).toBe(true)
  })

  it('accepts null runtime setting patch values', () => {
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      permissionMode: null,
      accessMode: null,
      interactionMode: null,
      providerNativeFlag: null,
    })).toBe(true)
  })

  it('rejects invalid known runtime setting values', () => {
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      accessMode: 'unsafe',
    })).toBe(false)
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      interactionMode: 'review',
    })).toBe(false)
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      permissionMode: 'unsafe',
    })).toBe(false)
  })

  it('accepts claudeAgent alias config alongside runtime settings', () => {
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      permissionMode: 'bypassPermissions',
      claudeAgent: {
        modelAliases: {
          haiku: 'claude-haiku-4-5',
          sonnet: 'claude-sonnet-4-6',
          opus: 'claude-opus-4-6',
        },
      },
    })).toBe(true)
  })

  it('rejects nested objects other than claudeAgent', () => {
    expect(Value.Check(sessionRuntimeSettingsPatchSchema, {
      permissionMode: 'plan',
      nested: { bad: true },
    })).toBe(false)
  })
})
