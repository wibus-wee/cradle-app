import { describe, expect, it } from 'vitest'

import type { RuntimeCatalogItem } from './runtime-catalog'
import {
  listRuntimeCatalogForSurface,
  runtimeCatalogItemHasSlotId,
  runtimeCatalogItemHasSlotName,
  runtimeCatalogItemRequiresProviderTarget,
  runtimeCatalogItemUsesAliasMatrixModelSelection,
  runtimeCatalogItemUsesCliLaunchConfig,
  runtimeCatalogItemUsesModelSelection,
  runtimeComposerSupportsSlashCommands,
} from './runtime-catalog'

function runtime(overrides: Partial<RuntimeCatalogItem> & { runtimeKind: string }): RuntimeCatalogItem {
  return {
    runtimeKind: overrides.runtimeKind,
    label: overrides.label ?? overrides.runtimeKind,
    description: overrides.description,
    providerKinds: overrides.providerKinds ?? [],
    providerBinding: overrides.providerBinding,
    sessionLaunchMode: overrides.sessionLaunchMode ?? 'runtime-provider',
    iconKey: overrides.iconKey,
    surfaces: overrides.surfaces ?? ['chat'],
    sortOrder: overrides.sortOrder,
    stability: overrides.stability,
    availability: overrides.availability ?? 'stable',
    degradations: overrides.degradations,
    icon: overrides.icon ?? { key: overrides.iconKey ?? 'custom' },
    composer: overrides.composer ?? {
      inputMode: 'rich',
      modelSelection: 'provider-model',
      thinking: 'per-model',
    },
    slots: overrides.slots ?? [],
    settingsSchema: overrides.settingsSchema,
    source: overrides.source ?? 'builtin',
    pluginOwner: overrides.pluginOwner ?? null,
    capabilities: overrides.capabilities ?? null,
  }
}

describe('listRuntimeCatalogForSurface', () => {
  it('uses server catalog surfaces without applying client-side runtime visibility policy', () => {
    const runtimes = [
      runtime({ runtimeKind: 'codex', surfaces: ['chat', 'jarvis'] }),
      runtime({ runtimeKind: 'standard', surfaces: ['chat'] }),
      runtime({ runtimeKind: 'opencode', surfaces: ['chat'] }),
      runtime({ runtimeKind: 'plugin-runtime', surfaces: ['jarvis'], source: 'plugin', pluginOwner: 'local' }),
    ]

    expect(listRuntimeCatalogForSurface(runtimes, 'chat').map(item => item.runtimeKind)).toEqual([
      'codex',
      'standard',
      'opencode',
    ])
    expect(listRuntimeCatalogForSurface(runtimes, 'jarvis').map(item => item.runtimeKind)).toEqual([
      'codex',
      'plugin-runtime',
    ])
  })

  it('preserves server-owned capability governance fields', () => {
    const capabilities: RuntimeCatalogItem['capabilities'] = {
      supportsSteerTurn: true,
      supportsShellExecution: false,
      supportsLastTurnRollback: false,
      supportsRuntimeSettings: true,
      supportsUiSlotStates: true,
      supportsDynamicCapabilities: false,
      supportsTitleGeneration: true,
      sessionModelSwitch: 'restart-session',
    }
    const degraded = runtime({
      runtimeKind: 'acp-chat',
      capabilities,
      composer: {
        inputMode: 'collapsed',
        modelSelection: 'none',
        thinking: 'unsupported',
      },
      icon: { key: 'custom' },
      slots: [{
        id: 'acp-chat:goal',
        name: 'goal',
        label: 'Goal',
        description: 'Goal state.',
        argumentHint: '',
        iconKey: 'goal',
        surfaces: ['composerState'],
      }],
      stability: 'experimental',
      availability: 'preview',
      degradations: [{
        capability: 'runtime',
        status: 'experimental',
        reason: 'Provider protocol is still stabilizing.',
      }],
    })

    expect(listRuntimeCatalogForSurface([degraded], 'chat')[0]).toEqual(expect.objectContaining({
      capabilities,
      composer: expect.objectContaining({ inputMode: 'collapsed' }),
      icon: { key: 'custom' },
      slots: [expect.objectContaining({ id: 'acp-chat:goal' })],
      stability: 'experimental',
      availability: 'preview',
      degradations: [expect.objectContaining({ capability: 'runtime' })],
    }))
  })
})

describe('runtimeCatalogItemUsesModelSelection', () => {
  it('uses runtime composer descriptor instead of runtime kind hard-coding', () => {
    expect(runtimeCatalogItemUsesModelSelection(runtime({ runtimeKind: 'custom-rich-runtime' }))).toBe(true)
    expect(runtimeCatalogItemUsesModelSelection(runtime({
      runtimeKind: 'custom-collapsed-runtime',
      composer: {
        inputMode: 'collapsed',
        modelSelection: 'none',
        thinking: 'unsupported',
      },
    }))).toBe(false)
  })
})

describe('runtimeCatalogItemUsesCliLaunchConfig', () => {
  it('uses runtime launch descriptor instead of runtime kind hard-coding', () => {
    expect(runtimeCatalogItemUsesCliLaunchConfig(runtime({ runtimeKind: 'custom-rich-runtime' }))).toBe(false)
    expect(runtimeCatalogItemUsesCliLaunchConfig(runtime({
      runtimeKind: 'custom-terminal-runtime',
      sessionLaunchMode: 'agent-terminal',
      composer: {
        inputMode: 'collapsed',
        modelSelection: 'none',
        thinking: 'unsupported',
      },
    }))).toBe(true)
  })
})

describe('runtimeCatalogItemRequiresProviderTarget', () => {
  it('uses provider binding and composer descriptors instead of runtime kind hard-coding', () => {
    expect(runtimeCatalogItemRequiresProviderTarget(runtime({
      runtimeKind: 'custom-provider-backed-runtime',
    }))).toBe(true)
    expect(runtimeCatalogItemRequiresProviderTarget(runtime({
      runtimeKind: 'custom-runtime-owned-runtime',
      providerBinding: 'runtime-owned',
      composer: {
        inputMode: 'rich',
        modelSelection: 'runtime-owned',
        thinking: 'per-model',
      },
    }))).toBe(false)
    expect(runtimeCatalogItemRequiresProviderTarget(runtime({
      runtimeKind: 'custom-cli-runtime',
      composer: {
        inputMode: 'collapsed',
        modelSelection: 'none',
        thinking: 'unsupported',
      },
    }))).toBe(false)
  })
})

describe('runtimeCatalogItemUsesAliasMatrixModelSelection', () => {
  it('uses runtime composer descriptor instead of runtime kind hard-coding', () => {
    expect(runtimeCatalogItemUsesAliasMatrixModelSelection(runtime({ runtimeKind: 'custom-rich-runtime' }))).toBe(false)
    expect(runtimeCatalogItemUsesAliasMatrixModelSelection(runtime({
      runtimeKind: 'custom-alias-runtime',
      composer: {
        inputMode: 'rich',
        modelSelection: 'alias-matrix',
        thinking: { efforts: ['low', 'medium', 'high'] },
      },
    }))).toBe(true)
  })
})

describe('runtimeCatalogItemHasSlot', () => {
  it('matches declared slots by id, name, and optional surface', () => {
    const descriptor = runtime({
      runtimeKind: 'custom-runtime',
      slots: [
        {
          id: 'custom-runtime:goal',
          name: 'goal',
          label: 'Goal',
          description: 'Set the active objective.',
          argumentHint: '<objective>',
          iconKey: 'goal',
          commandText: '/goal ',
          surfaces: ['slashCommand', 'composerState'],
        },
        {
          id: 'custom-runtime:plugins',
          name: 'plugins',
          label: 'Plugins',
          description: 'Show runtime plugins.',
          argumentHint: '',
          iconKey: 'plugin',
          surfaces: ['runtimePanel'],
        },
      ],
    })

    expect(runtimeCatalogItemHasSlotName(descriptor, 'goal', 'slashCommand')).toBe(true)
    expect(runtimeCatalogItemHasSlotName(descriptor, 'goal', 'runtimePanel')).toBe(false)
    expect(runtimeCatalogItemHasSlotId(descriptor, 'custom-runtime:plugins')).toBe(true)
    expect(runtimeCatalogItemHasSlotId(descriptor, 'custom-runtime:missing')).toBe(false)
  })
})

describe('runtimeComposerSupportsSlashCommands', () => {
  it('only enables slash commands for rich composer input', () => {
    expect(runtimeComposerSupportsSlashCommands({
      inputMode: 'rich',
      modelSelection: 'provider-model',
      thinking: 'per-model',
    })).toBe(true)
    expect(runtimeComposerSupportsSlashCommands({
      inputMode: 'collapsed',
      modelSelection: 'none',
      thinking: 'unsupported',
    })).toBe(false)
    expect(runtimeComposerSupportsSlashCommands({
      inputMode: 'none',
      modelSelection: 'none',
      thinking: 'unsupported',
    })).toBe(false)
  })
})
