import { describe, expect, it } from 'vitest'

import {
  getDefaultRuntimeSettings,
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  resolveRunRuntimeSettings,
} from './runtime-settings'

describe('resolveRunRuntimeSettings', () => {
  const runtimeKind = 'codex'

  it('returns session settings when the request omits runtime settings', () => {
    expect(resolveRunRuntimeSettings(runtimeKind, {
      accessMode: 'approval-required',
      interactionMode: 'plan',
    })).toEqual({
      accessMode: 'approval-required',
      interactionMode: 'plan',
    })
  })

  it('keeps session plan mode when the client sends the full stale default bundle', () => {
    expect(resolveRunRuntimeSettings(
      runtimeKind,
      { accessMode: 'full-access', interactionMode: 'plan' },
      getDefaultRuntimeSettings(runtimeKind),
    )).toEqual({
      accessMode: 'full-access',
      interactionMode: 'plan',
    })
  })

  it('keeps session approval-required when the client sends only stale full-access defaults', () => {
    expect(resolveRunRuntimeSettings(
      runtimeKind,
      { accessMode: 'approval-required', interactionMode: 'default' },
      getDefaultRuntimeSettings(runtimeKind),
    )).toEqual({
      accessMode: 'approval-required',
      interactionMode: 'default',
    })
  })

  it('applies explicit request overrides that differ from defaults', () => {
    expect(resolveRunRuntimeSettings(
      runtimeKind,
      { accessMode: 'full-access', interactionMode: 'plan' },
      { accessMode: 'approval-required', interactionMode: 'default' },
    )).toEqual({
      accessMode: 'approval-required',
      interactionMode: 'default',
    })
  })
})

describe('standard runtime service tier settings', () => {
  const runtimeKind = 'standard'

  it('accepts a tier the selected model declared', () => {
    expect(normalizeRuntimeSettingsPatch(runtimeKind, { serviceTier: 'priority' })).toEqual({
      serviceTier: 'priority',
    })
    expect(resolveRunRuntimeSettings(runtimeKind, {}, { serviceTier: 'priority' })).toEqual({
      serviceTier: 'priority',
    })
  })

  it('does not wipe a chosen tier when the request names none', () => {
    expect(resolveRunRuntimeSettings(runtimeKind, { serviceTier: 'priority' }, {})).toEqual({
      serviceTier: 'priority',
    })
  })

  it('clears a tier on an explicit empty value, because the patch channel has no delete', () => {
    expect(normalizeRuntimeSettingsPatch(runtimeKind, { serviceTier: '' })).toEqual({
      serviceTier: '',
    })
    expect(mergeRuntimeSettings(runtimeKind, { serviceTier: 'priority' }, { serviceTier: '' })).toEqual({})
  })

  it('drops tiers that are not strings and absurdly long values', () => {
    expect(normalizeRuntimeSettingsPatch(runtimeKind, { serviceTier: 42 })).toEqual({})
    expect(normalizeRuntimeSettingsPatch(runtimeKind, { serviceTier: 'x'.repeat(65) })).toEqual({})
    expect(normalizeRuntimeSettingsPatch(runtimeKind, { serviceTier: '  priority  ' })).toEqual({
      serviceTier: 'priority',
    })
  })
})
