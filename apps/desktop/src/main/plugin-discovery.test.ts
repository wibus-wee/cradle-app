/* Verifies desktop plugin discovery descriptor projection. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverDesktopPlugins } from './plugin-discovery'

let tempPluginsDir: string | undefined

async function writeDesktopPluginPackage(): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-desktop-plugin-discovery-'))
  const pluginDir = join(pluginsRoot, 'marketplace-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/marketplace-plugin',
      type: 'module',
      version: '1.2.3',
      cradle: {
        apiVersion: '1',
        desktop: 'desktop.mjs',
        contributes: {
          capabilities: [],
          permissions: [],
        },
      },
    }),
  )
  await writeFile(join(pluginDir, 'desktop.mjs'), 'export function activate() {}')
  await writeFile(
    join(pluginDir, 'cradle-marketplace-install.json'),
    JSON.stringify({
      schemaVersion: 1,
      installedAt: '2026-05-21T10:00:00.000Z',
      mode: 'downloaded',
      source: 'github',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/marketplace-plugin',
      packageName: '@cradle/marketplace-plugin',
      version: '1.2.3',
      channel: 'bundled',
      ref: 'main',
      originalUrl: 'cradle://plugins/install?source=github',
      grantedPermissions: ['desktop.permission'],
    }),
  )
  return pluginsRoot
}

async function writeUnsupportedDesktopPluginPackage(): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-desktop-plugin-discovery-unsupported-'))
  const pluginDir = join(pluginsRoot, 'unsupported-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/unsupported-manifest',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        desktop: 'desktop.mjs',
        contributes: {
          capabilities: [],
          permissions: [],
        },
        capabilities: ['legacy-capability'],
        permissions: ['legacy-permission'],
      },
    }),
  )
  await writeFile(join(pluginDir, 'desktop.mjs'), 'export function activate() {}')
  return pluginsRoot
}

describe('desktop plugin discovery', () => {
  afterEach(async () => {
    if (tempPluginsDir) {
      await rm(tempPluginsDir, { recursive: true, force: true })
      tempPluginsDir = undefined
    }
  })

  it('projects Marketplace install receipt provenance into descriptors', async () => {
    tempPluginsDir = await writeDesktopPluginPackage()

    const result = await discoverDesktopPlugins([{
      pluginsDir: tempPluginsDir,
      kind: 'externalLocal',
      trusted: true,
      reason: 'Marketplace installed plugin directory',
    }])

    expect(result.manifests.map(manifest => manifest.name)).toEqual(['@cradle/marketplace-plugin'])
    expect(result.descriptors[0]?.activation).toEqual({
      enabled: true,
      source: 'default',
    })
    expect(result.descriptors[0]?.source.provenance).toMatchObject({
      kind: 'marketplace-install',
      mode: 'downloaded',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/marketplace-plugin',
      packageName: '@cradle/marketplace-plugin',
      version: '1.2.3',
      ref: 'main',
    })
    expect(result.descriptors[0]?.source.provenance?.grantedPermissions).toEqual(['desktop.permission'])
    expect(result.descriptors[0]?.source.grantedPermissions).toBeUndefined()
  })

  it('projects Marketplace receipt grants only from trusted Marketplace sources', async () => {
    tempPluginsDir = await writeDesktopPluginPackage()

    const result = await discoverDesktopPlugins([{
      pluginsDir: tempPluginsDir,
      kind: 'externalLocal',
      trusted: true,
      reason: 'Cradle Marketplace installed plugin directory',
      trustMarketplaceGrants: true,
    }])

    expect(result.descriptors[0]?.source.provenance?.grantedPermissions).toEqual(['desktop.permission'])
    expect(result.descriptors[0]?.source.grantedPermissions).toEqual(['desktop.permission'])
  })

  it('rejects legacy manifest declaration arrays during discovery', async () => {
    tempPluginsDir = await writeUnsupportedDesktopPluginPackage()

    const result = await discoverDesktopPlugins([{
      pluginsDir: tempPluginsDir,
      kind: 'externalLocal',
      trusted: true,
      reason: 'Marketplace installed plugin directory',
    }])

    expect(result.manifests).toHaveLength(0)
    expect(result.descriptors[0]?.identity).toBe('')
    expect(result.descriptors[0]?.activation).toEqual({
      enabled: true,
      source: 'default',
    })
    expect(result.descriptors[0]?.layers.desktop.status).toBe('invalid')
    expect(result.descriptors[0]?.warnings.join('\n')).toContain(
      'cradle.capabilities is not supported in apiVersion 1; use cradle.contributes.capabilities.',
    )
    expect(result.descriptors[0]?.warnings.join('\n')).toContain(
      'cradle.permissions is not supported in apiVersion 1; use cradle.contributes.permissions.',
    )
  })
})
