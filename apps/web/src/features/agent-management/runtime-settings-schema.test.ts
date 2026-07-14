import { describe, expect, it } from 'vitest'

import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'

import {
  listRuntimeSettingsDescriptorsForProviderKind,
  listRuntimeSettingsFields,
  readRuntimeSettingsFormValues,
  writeRuntimeSettingsConfig,
} from './runtime-settings-schema'

function runtimeCatalogItem(overrides: Partial<RuntimeCatalogItem> & { runtimeKind: string }): RuntimeCatalogItem {
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

function remoteMockRuntime(overrides: Partial<RuntimeCatalogItem> = {}): RuntimeCatalogItem {
  return runtimeCatalogItem({
    runtimeKind: 'remote-mock',
    label: 'Remote Mock',
    providerKinds: ['openai-compatible'],
    sortOrder: 20,
    settingsSchema: {
      type: 'object',
      required: ['remoteHostId'],
      properties: {
        remoteHostId: {
          type: 'string',
          title: 'Remote host',
          description: 'Host identifier used by the runtime.',
          default: 'local-dev',
        },
        remoteRuntimeKind: {
          enum: ['codex', 'claude-agent'],
          title: 'Remote runtime',
          default: 'codex',
        },
        remoteWorkspacePath: {
          type: ['string', 'null'],
          title: 'Workspace path',
        },
        enableBridge: {
          type: 'boolean',
          title: 'Bridge enabled',
          default: true,
        },
        retryLimit: {
          type: 'integer',
          title: 'Retry limit',
          default: 2.9,
        },
        temperature: {
          type: 'number',
          title: 'Temperature',
          default: '0.7',
        },
        ignoredObject: {
          type: 'object',
          title: 'Ignored object',
        },
      },
    },
    ...overrides,
  })
}

describe('runtime-settings-schema', () => {
  it('filters provider-compatible descriptors with settings schemas', () => {
    const runtimes = [
      runtimeCatalogItem({
        runtimeKind: 'anthropic-runtime',
        providerKinds: ['anthropic'],
        settingsSchema: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
          },
        },
      }),
      runtimeCatalogItem({
        runtimeKind: 'missing-schema',
        providerKinds: ['openai-compatible'],
      }),
      remoteMockRuntime(),
      runtimeCatalogItem({
        runtimeKind: 'early-openai-runtime',
        providerKinds: ['openai-compatible'],
        sortOrder: 10,
        settingsSchema: {
          type: 'object',
          properties: {
            host: { type: 'string' },
          },
        },
      }),
    ]

    expect(
      listRuntimeSettingsDescriptorsForProviderKind(runtimes, 'openai-compatible')
        .map(runtime => runtime.runtimeKind),
    ).toEqual(['early-openai-runtime', 'remote-mock'])
  })

  it('projects JSON schema properties into editable runtime settings fields', () => {
    expect(listRuntimeSettingsFields([remoteMockRuntime()])).toEqual([
      {
        runtimeKind: 'remote-mock',
        runtimeLabel: 'Remote Mock',
        key: 'remoteHostId',
        label: 'Remote host',
        description: 'Host identifier used by the runtime.',
        required: true,
        type: 'string',
        defaultValue: 'local-dev',
        enumOptions: undefined,
      },
      {
        runtimeKind: 'remote-mock',
        runtimeLabel: 'Remote Mock',
        key: 'remoteRuntimeKind',
        label: 'Remote runtime',
        description: undefined,
        required: false,
        type: 'string',
        defaultValue: 'codex',
        enumOptions: [
          { value: 'codex', label: 'codex' },
          { value: 'claude-agent', label: 'claude-agent' },
        ],
      },
      {
        runtimeKind: 'remote-mock',
        runtimeLabel: 'Remote Mock',
        key: 'remoteWorkspacePath',
        label: 'Workspace path',
        description: undefined,
        required: false,
        type: 'string',
        defaultValue: undefined,
        enumOptions: undefined,
      },
      {
        runtimeKind: 'remote-mock',
        runtimeLabel: 'Remote Mock',
        key: 'enableBridge',
        label: 'Bridge enabled',
        description: undefined,
        required: false,
        type: 'boolean',
        defaultValue: true,
        enumOptions: undefined,
      },
      {
        runtimeKind: 'remote-mock',
        runtimeLabel: 'Remote Mock',
        key: 'retryLimit',
        label: 'Retry limit',
        description: undefined,
        required: false,
        type: 'integer',
        defaultValue: 2,
        enumOptions: undefined,
      },
      {
        runtimeKind: 'remote-mock',
        runtimeLabel: 'Remote Mock',
        key: 'temperature',
        label: 'Temperature',
        description: undefined,
        required: false,
        type: 'number',
        defaultValue: 0.7,
        enumOptions: undefined,
      },
    ])
  })

  it('reads config values with schema defaults for missing fields', () => {
    const fields = listRuntimeSettingsFields([remoteMockRuntime()])

    expect(readRuntimeSettingsFormValues({
      remoteHostId: 'prod-host',
      remoteWorkspacePath: '/work/project',
      enableBridge: false,
      retryLimit: '4',
    }, fields)).toEqual({
      remoteHostId: 'prod-host',
      remoteRuntimeKind: 'codex',
      remoteWorkspacePath: '/work/project',
      enableBridge: false,
      retryLimit: 4,
      temperature: 0.7,
    })
  })

  it('writes runtime settings without removing unrelated config keys', () => {
    const fields = listRuntimeSettingsFields([remoteMockRuntime()])

    expect(writeRuntimeSettingsConfig(
      {
        model: 'gpt-5',
        remoteHostId: 'old-host',
        extraKey: 'preserved',
      },
      fields,
      {
        remoteHostId: 'new-host',
        remoteRuntimeKind: 'claude-agent',
        retryLimit: 5,
        temperature: 0.3,
      },
    )).toEqual({
      model: 'gpt-5',
      remoteHostId: 'new-host',
      remoteRuntimeKind: 'claude-agent',
      retryLimit: 5,
      temperature: 0.3,
      extraKey: 'preserved',
    })
  })
})
