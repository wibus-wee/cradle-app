import type { PluginManifest } from '@cradle/plugin-sdk'
import { CradlePluginPackageJsonSchema } from '@cradle/plugin-sdk/manifest'
import type { ProviderExtension } from '@cradle/plugin-sdk/server'
import { afterEach, describe, expect, it } from 'vitest'

import {
  deriveProviderExtensionKey,
  findProviderExtension,
  listProviderExtensions,
  registerProviderExtension,
  resetProviderExtensionRegistry,
} from './provider-extension-registry'
import {
  createPluginDescriptor,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
} from './runtime-registry'

function manifest(includePermission = true): PluginManifest {
  const pkg = CradlePluginPackageJsonSchema.parse({
    name: '@cradle/test-provider-extension',
    version: '1.0.0',
    cradle: {
      apiVersion: '1',
      server: 'src/server.ts',
      contributes: {
        capabilities: [{
          id: 'provider-extension.protocol-bridge',
          type: 'provider-extension',
          layer: 'server',
          permissions: includePermission ? ['provider.credentials.use'] : [],
        }],
        permissions: includePermission
          ? [{ id: 'provider.credentials.use', required: true }]
          : [],
      },
    },
  })
  return {
    name: pkg.name,
    version: pkg.version,
    packageDir: `/plugins/${pkg.name}`,
    cradle: pkg.cradle,
  }
}

function extension(): ProviderExtension {
  return {
    id: 'protocol-bridge',
    label: 'Protocol bridge',
    conversions: [{
      fromProviderKind: 'openai-compatible',
      routedProviderKinds: ['universal'],
      addedProviderKinds: ['universal'],
    }],
    getApplicability: () => ({ applicable: true, credentialStrategy: 'borrowed-static' }),
    onEnable: async () => ({ providerKinds: ['universal'], state: {} }),
    onDisable: async () => {},
    onReconcile: async () => ({ providerKinds: ['universal'], state: {} }),
    resolveRuntime: () => ({ providerKind: 'universal', config: {} }),
  }
}

function registerDescriptor(pluginManifest: PluginManifest): void {
  registerPluginDescriptor(createPluginDescriptor(pluginManifest, {
    kind: 'workspaceDev',
    packageDir: pluginManifest.packageDir,
    trusted: true,
  }))
}

describe('provider extension registry', () => {
  afterEach(() => {
    resetProviderExtensionRegistry()
    resetPluginRuntimeRegistry()
  })

  it('registers and disposes a permission-gated extension', () => {
    const pluginManifest = manifest()
    registerDescriptor(pluginManifest)

    const disposable = registerProviderExtension(pluginManifest.name, extension())

    expect(listProviderExtensions()).toHaveLength(1)
    expect(findProviderExtension(pluginManifest.name, 'protocol-bridge')?.key).toBe(
      deriveProviderExtensionKey(pluginManifest.name, 'protocol-bridge'),
    )

    disposable.dispose()
    expect(listProviderExtensions()).toHaveLength(0)
  })

  it('rejects an extension without credential permission', () => {
    const pluginManifest = manifest(false)
    registerDescriptor(pluginManifest)

    expect(() => registerProviderExtension(pluginManifest.name, extension())).toThrow(
      'must declare permission provider.credentials.use',
    )
  })
})
