import { describe, expect, it } from 'vitest'

import type { AgentProfile } from '~/features/agent-runtime/types'

import { collectProviderListGroups, sortProviderProfilesByStatus } from './provider-list-groups'
import type { ExternalProviderRecordView, ExternalProviderSourceView } from './provider-settings-utils'

function profile(input: Pick<AgentProfile, 'id' | 'name' | 'enabled'>): AgentProfile {
  return {
    ...input,
    providerKind: 'openai-compatible',
    configJson: '{}',
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

function externalSource(input: Pick<ExternalProviderSourceView, 'id' | 'pluginName' | 'sourceId' | 'label'>): ExternalProviderSourceView {
  return {
    ...input,
    lastSyncStatus: 'ok',
    lastSyncMessage: null,
    lastSyncError: null,
    lastSyncAt: 0,
    inventory: {},
    warnings: [],
  }
}

function externalRecord(input: Pick<ExternalProviderRecordView, 'id' | 'sourceKey' | 'externalId' | 'name' | 'providerKind'>): ExternalProviderRecordView {
  return {
    ...input,
    providerTargetId: `target-${input.id}`,
    app: 'codex',
    status: 'active',
    runtimeTargetEnabled: true,
    metadata: {},
    warnings: [],
  }
}

describe('provider-list-groups', () => {
  it('sorts enabled providers before disabled providers', () => {
    expect(
      sortProviderProfilesByStatus([
        profile({ id: 'off-b', name: 'Beta', enabled: false }),
        profile({ id: 'on-c', name: 'Charlie', enabled: true }),
        profile({ id: 'on-a', name: 'Alpha', enabled: true }),
      ]).map(item => item.id),
    ).toEqual(['on-a', 'on-c', 'off-b'])
  })

  it('groups provider profiles under the Cradle-owned manual provider group', () => {
    const groups = collectProviderListGroups([
      profile({ id: 'off-b', name: 'Beta', enabled: false }),
      profile({ id: 'on-a', name: 'Alpha', enabled: true }),
    ])

    expect(
      groups.map(group => ({ id: group.id, entries: group.entries.map(item => item.id) })),
    ).toEqual([
      { id: 'manual', entries: ['manual:on-a', 'manual:off-b'] },
    ])
    expect(groups[0]?.label).toBe('Manual providers')
  })

  it('groups records from every external provider source', () => {
    const groups = collectProviderListGroups(
      [],
      [
        externalRecord({
          id: 'local-codex',
          sourceKey: 'source-local',
          externalId: 'codex:local-current',
          name: 'Local Codex',
          providerKind: 'openai-compatible',
        }),
        externalRecord({
          id: 'custom-anyrouter',
          sourceKey: 'source-custom',
          externalId: 'custom:codex:anyrouter',
          name: 'AnyRouter',
          providerKind: 'openai-compatible',
        }),
      ],
      [
        externalSource({
          id: 'source-local',
          pluginName: 'cradle-onboarding',
          sourceId: 'local-agent-config',
          label: 'Local Agent Config',
        }),
        externalSource({
          id: 'source-custom',
          pluginName: 'custom-provider-plugin',
          sourceId: 'custom-provider-source',
          label: 'Custom Providers',
        }),
      ],
    )

    expect(groups.map(group => ({
      label: group.label,
      entries: group.entries.map(entry => entry.kind === 'external' ? entry.record.name : entry.profile.name),
    }))).toEqual([
      { label: 'Custom Providers', entries: ['AnyRouter'] },
      { label: 'Local Agent Config', entries: ['Local Codex'] },
    ])
  })
})
