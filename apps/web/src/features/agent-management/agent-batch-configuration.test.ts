import { describe, expect, it } from 'vitest'

import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'
import type { Agent } from '~/features/agent-runtime/use-agents'

import { buildAgentProviderBatchPatches } from './agent-batch-configuration'

function createAgent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-a',
    name: overrides.name ?? 'Agent A',
    description: overrides.description ?? 'Description',
    avatarUrl: overrides.avatarUrl ?? null,
    avatarStyle: overrides.avatarStyle ?? 'bottts-neutral',
    avatarSeed: overrides.avatarSeed ?? 'seed',
    providerTargetId: overrides.providerTargetId ?? 'profile-old',
    modelId: overrides.modelId ?? 'model-old',
    thinkingEffort: overrides.thinkingEffort ?? 'high',
    runtimeKind: overrides.runtimeKind ?? 'standard',
    configJson: overrides.configJson ?? '{}',
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
  }
}

function createRuntimeCatalogItem(overrides: Partial<RuntimeCatalogItem> & { runtimeKind: string }): RuntimeCatalogItem {
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

const RUNTIME_CATALOG = [
  createRuntimeCatalogItem({ runtimeKind: 'standard' }),
  createRuntimeCatalogItem({ runtimeKind: 'claude-agent' }),
  createRuntimeCatalogItem({
    runtimeKind: 'terminal-runtime',
    sessionLaunchMode: 'agent-terminal',
    composer: {
      inputMode: 'collapsed',
      modelSelection: 'none',
      thinking: 'unsupported',
    },
  }),
]

describe('buildAgentProviderBatchPatches', () => {
  it('updates provider fields while preserving agent identity and runtime config', () => {
    const result = buildAgentProviderBatchPatches(
      [
        createAgent({
          id: 'agent-a',
          name: 'A',
          avatarSeed: 'avatar-a',
          runtimeKind: 'claude-agent',
          configJson: '{"systemPrompt":"Keep this"}',
          enabled: false,
        }),
      ],
      {
        providerTarget: { kind: 'manual', id: 'profile-new' },
        modelId: 'model-new',
        thinkingEffort: 'high',
      },
      RUNTIME_CATALOG,
    )

    expect(result).toEqual({
      skippedRuntimeOwnedCount: 0,
      patches: [
        {
          id: 'agent-a',
          patch: {
            name: 'A',
            description: 'Description',
            avatarStyle: 'bottts-neutral',
            avatarSeed: 'avatar-a',
            providerTargetId: 'profile-new',
            modelId: 'model-new',
            thinkingEffort: 'high',
            runtimeKind: 'claude-agent',
            configJson: '{"systemPrompt":"Keep this"}',
            enabled: false,
          },
        },
      ],
    })
  })

  it('skips runtime-owned agents because they are not provider-backed', () => {
    const result = buildAgentProviderBatchPatches(
      [
        createAgent({ id: 'provider-agent', runtimeKind: 'standard' }),
        createAgent({
          id: 'terminal-agent',
          runtimeKind: 'terminal-runtime',
          providerTargetId: null,
          modelId: null,
        }),
      ],
      {
        providerTarget: { kind: 'manual', id: 'profile-new' },
        modelId: 'model-new',
        thinkingEffort: 'high',
      },
      RUNTIME_CATALOG,
    )

    expect(result.skippedRuntimeOwnedCount).toBe(1)
    expect(result.patches).toHaveLength(1)
    expect(result.patches[0]?.id).toBe('provider-agent')
  })

  it('rejects provider-backed batch patches without a resolved model', () => {
    expect(() =>
      buildAgentProviderBatchPatches(
        [createAgent({ id: 'provider-agent', runtimeKind: 'standard' })],
        {
          providerTarget: { kind: 'manual', id: 'profile-new' },
          modelId: null,
          thinkingEffort: 'high',
        },
        RUNTIME_CATALOG,
      )).toThrow('resolved model')
  })

  it('writes external provider targets without fabricating a profile id', () => {
    const result = buildAgentProviderBatchPatches(
      [createAgent({ id: 'agent-external', providerTargetId: 'external-target-old' })],
      {
        providerTarget: { kind: 'external', id: 'external-target-new' },
        modelId: 'model-new',
        thinkingEffort: 'medium',
      },
      RUNTIME_CATALOG,
    )

    expect(result.patches[0]?.patch).toEqual(expect.objectContaining({
      providerTargetId: 'external-target-new',
      modelId: 'model-new',
      thinkingEffort: 'medium',
    }))
  })
})
