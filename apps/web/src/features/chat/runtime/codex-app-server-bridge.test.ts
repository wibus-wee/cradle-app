import { describe, expect, it } from 'vitest'

import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'

import {
  runtimeSupportsCodexGoalBridge,
  runtimeSupportsCodexPluginMentions,
} from './codex-app-server-bridge'

type RuntimeSlot = RuntimeCatalogItem['slots'][number]

function runtime(slots: RuntimeSlot[]): Pick<RuntimeCatalogItem, 'slots'> {
  return { slots }
}

function slot(overrides: Partial<RuntimeSlot> & { id: string, name: string }): RuntimeSlot {
  return {
    id: overrides.id,
    name: overrides.name,
    label: overrides.label ?? overrides.name,
    description: overrides.description ?? '',
    argumentHint: overrides.argumentHint ?? '',
    aliases: overrides.aliases,
    iconKey: overrides.iconKey,
    commandText: overrides.commandText,
    commandAction: overrides.commandAction,
    requiresSession: overrides.requiresSession,
    surfaces: overrides.surfaces ?? ['slashCommand'],
  }
}

describe('runtimeSupportsCodexGoalBridge', () => {
  it('only enables the Codex host bridge for the Codex goal slot', () => {
    expect(runtimeSupportsCodexGoalBridge(runtime([
      slot({ id: 'codex:goal', name: 'goal', surfaces: ['slashCommand', 'runtimePanel'] }),
    ]))).toBe(true)

    expect(runtimeSupportsCodexGoalBridge(runtime([
      slot({ id: 'custom-runtime:goal', name: 'goal', surfaces: ['slashCommand'] }),
    ]))).toBe(false)

    expect(runtimeSupportsCodexGoalBridge(runtime([
      slot({ id: 'codex:goal', name: 'goal', surfaces: ['runtimePanel'] }),
    ]))).toBe(false)
  })
})

describe('runtimeSupportsCodexPluginMentions', () => {
  it('only enables native Codex plugin mentions for the Codex plugin slot', () => {
    expect(runtimeSupportsCodexPluginMentions(runtime([
      slot({ id: 'codex:plugin', name: 'plugins', surfaces: ['runtimePanel'] }),
    ]))).toBe(true)

    expect(runtimeSupportsCodexPluginMentions(runtime([
      slot({ id: 'custom-runtime:plugins', name: 'plugins', surfaces: ['runtimePanel'] }),
    ]))).toBe(false)
  })
})
