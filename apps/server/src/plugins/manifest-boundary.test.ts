import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

const hostManifestConsumers = [
  'apps/server/src/plugins/discovery.ts',
  'apps/desktop/src/main/plugin-discovery.ts',
  'apps/desktop/src/main/plugin-install-links.ts',
]

const firstPartyPluginManifests = [
  'plugins/system-info/package.json',
  'plugins/browser-use/package.json',
  'plugins/cc-switch/package.json',
  'plugins/nowledge-mem/package.json',
]

describe('plugin manifest SDK boundary', () => {
  it('keeps host discovery and install code on the SDK parser contract', async () => {
    for (const file of hostManifestConsumers) {
      const source = await readFile(resolve(repoRoot, file), 'utf8')

      expect(source, file).toContain(`parseCradlePlugin${'PackageJsonText'}`)
      expect(source, file).not.toContain('CradlePluginPackageJsonTextSchema')
    }
  })

  it('exports manifest schemas and parser helpers from the SDK manifest module', async () => {
    const manifestModule = await import('@cradle/plugin-sdk/manifest')

    expect(Object.keys(manifestModule).sort()).toEqual([
      'CradlePluginManifestError',
      'CradlePluginPackageJsonSchema',
      'CradlePluginPackageJsonTextSchema',
      'parseCradlePluginPackageJson',
      'parseCradlePluginPackageJsonText',
      'validatePluginEntryPath',
    ])
  })

  it('keeps first-party plugin manifests valid under the strict v1 schema', async () => {
    const { parseCradlePluginPackageJsonText } = await import('@cradle/plugin-sdk/manifest')

    for (const file of firstPartyPluginManifests) {
      const source = await readFile(resolve(repoRoot, file), 'utf8')
      const pkg = parseCradlePluginPackageJsonText(source)

      expect(pkg.cradle.contributes.capabilities, file).toBeInstanceOf(Array)
      expect(pkg.cradle.contributes.permissions, file).toBeInstanceOf(Array)
      for (const capability of pkg.cradle.contributes.capabilities) {
        expect(capability.permissions, `${file}:${capability.id}`).toBeInstanceOf(Array)
      }
    }
  })
})
