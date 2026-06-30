import type { PluginManifest } from '@cradle/plugin-sdk'
import { CradlePluginPackageJsonSchema } from '@cradle/plugin-sdk/manifest'
import { afterEach, describe, expect, it } from 'vitest'

import {
  classifyPluginSource,
  createPluginDescriptor,
  listPluginDescriptors,
  registerPluginCapability,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
} from './runtime-registry'

function manifest(name: string, cradle: Record<string, unknown> = {}): PluginManifest {
  const pkg = CradlePluginPackageJsonSchema.parse({
    name,
    version: '1.0.0',
    cradle: {
      apiVersion: '1',
      contributes: {
        capabilities: [],
        permissions: [],
      },
      ...cradle,
    },
  })

  return {
    name: pkg.name,
    version: pkg.version,
    packageDir: `/plugins/${name}`,
    cradle: pkg.cradle,
  }
}

describe('plugin runtime registry', () => {
  afterEach(() => {
    resetPluginRuntimeRegistry()
    delete process.env.CRADLE_PLUGINS_DIR
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    delete process.env.NODE_ENV
  })

  it('keeps package name as identity while deriving a legacy-compatible route segment', () => {
    const descriptor = createPluginDescriptor(
      manifest('@cradle/system-info', { server: 'src/server.ts', web: 'dist/web.mjs' }),
      classifyPluginSource('/repo/plugins/system-info', '/repo/plugins'),
    )

    expect(descriptor.identity).toBe('@cradle/system-info')
    expect(descriptor.routeSegment).toBe('system-info')
    expect(descriptor.layers.server.status).toBe('discovered')
    expect(descriptor.layers.web.status).toBe('discovered')
    expect(descriptor.layers.desktop.status).toBe('skipped')
  })

  it('does not warn for v1 plugin metadata', () => {
    const descriptor = createPluginDescriptor(
      manifest('@cradle/v1-plugin', { apiVersion: '1', server: 'src/server.ts' }),
      classifyPluginSource('/repo/plugins/v1-plugin', '/repo/plugins'),
    )

    expect(descriptor.warnings).toHaveLength(0)
  })

  it('marks route collisions invalid without replacing the first owner', () => {
    const first = createPluginDescriptor(
      manifest('@cradle/plugin-sample', { server: 'a.ts' }),
      classifyPluginSource('/repo/plugins/a', '/repo/plugins'),
    )
    const second = createPluginDescriptor(
      manifest('@cradle/sample', { server: 'b.ts' }),
      classifyPluginSource('/repo/plugins/b', '/repo/plugins'),
    )

    registerPluginDescriptor(first)
    registerPluginDescriptor(second)

    const descriptors = listPluginDescriptors()
    expect(descriptors).toHaveLength(2)
    expect(descriptors.find(d => d.identity === '@cradle/plugin-sample')?.layers.server.status).toBe('discovered')
    expect(descriptors.find(d => d.identity === '@cradle/sample')?.layers.server.status).toBe('invalid')
  })

  it('marks both package-name duplicates invalid so neither can activate', () => {
    const first = createPluginDescriptor(
      manifest('@external/duplicate', { server: 'a.ts' }),
      classifyPluginSource('/external/plugins/a', '/external/plugins', 'externalLocal'),
    )
    const second = createPluginDescriptor(
      {
        ...manifest('@external/duplicate', { server: 'b.ts' }),
        packageDir: '/external/plugins/b',
      },
      classifyPluginSource('/external/plugins/b', '/external/plugins', 'externalLocal'),
    )

    registerPluginDescriptor(first)
    registerPluginDescriptor(second)

    const descriptors = listPluginDescriptors().filter(d => d.identity === '@external/duplicate')
    expect(descriptors).toHaveLength(2)
    expect(descriptors.every(d => d.layers.server.status === 'invalid')).toBe(true)
  })

  it('records duplicate capability ids with stable suffixes', () => {
    const descriptor = createPluginDescriptor(
      manifest('@cradle/browser-use', { server: 'dist/server.mjs' }),
      classifyPluginSource('/repo/plugins/browser-use', '/repo/plugins'),
    )
    registerPluginDescriptor(descriptor)

    const first = registerPluginCapability('@cradle/browser-use', 'hook', 'server', 'before-query')
    const second = registerPluginCapability('@cradle/browser-use', 'hook', 'server', 'before-query')

    expect(first.id).toBe('@cradle/browser-use:hook.before-query')
    expect(second.id).toBe('@cradle/browser-use:hook.before-query#2')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(2)
  })

  it('classifies configured external roots as trusted external local sources', () => {
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = '/external/plugins'

    const source = classifyPluginSource('/external/plugins/example', '/external/plugins', 'externalLocal')

    expect(source.kind).toBe('externalLocal')
    expect(source.trusted).toBe(true)
    expect(source.reason).toContain('trusted operator-selected code')
  })

  it('projects structured manifest declarations into descriptor records', () => {
    const descriptor = createPluginDescriptor(
      manifest('@cradle/declarations', {
        server: 'src/server.ts',
        contributes: {
          capabilities: [
            {
              id: 'provider-source',
              type: 'external-provider-source',
              layer: 'server',
              label: 'Provider Source',
              permissions: ['filesystem'],
            },
          ],
          permissions: [
            {
              id: 'network',
              label: 'Network access',
              required: false,
            },
          ],
        },
      }),
      classifyPluginSource('/repo/plugins/declarations', '/repo/plugins'),
    )

    expect(descriptor.declaredCapabilities.map(capability => ({
      id: capability.id,
      localId: capability.localId,
      type: capability.type,
      layer: capability.layer,
    }))).toEqual([
      {
        id: '@cradle/declarations:provider-source',
        localId: 'provider-source',
        type: 'external-provider-source',
        layer: 'server',
      },
    ])
    expect(descriptor.declaredPermissions.map(permission => ({
      id: permission.id,
      localId: permission.localId,
      required: permission.required,
    }))).toEqual([
      {
        id: '@cradle/declarations:network',
        localId: 'network',
        required: false,
      },
    ])
  })

  it('rejects invalid structured declarations at the manifest boundary', () => {
    expect(() => CradlePluginPackageJsonSchema.parse({
      name: '@cradle/declaration-warnings',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: 'src/server.ts',
        contributes: {
          capabilities: [
            { id: '', type: 'mcp-server' },
            { id: 'missing-type' },
          ],
          permissions: [
            { label: 'Missing id' },
          ],
        },
      },
    })).toThrow(/contributes/)
  })

  it('requires explicit manifest contributions in apiVersion 1', () => {
    expect(() => CradlePluginPackageJsonSchema.parse({
      name: '@cradle/missing-contributes',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: 'src/server.ts',
      },
    })).toThrow(/contributes/)
  })
})
