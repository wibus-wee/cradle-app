import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

const runtimeManifestConsumers = [
  'apps/server/src/plugins/discovery.ts',
  'apps/desktop/src/main/plugin-discovery.ts',
  'apps/desktop/src/main/plugin-install-links.ts',
]

describe('plugin SDK contract boundary', () => {
  it('exports manifest schemas and parser helpers from the SDK manifest module', async () => {
    const sdkManifest = await import('@cradle/plugin-sdk/manifest')

    expect(Object.keys(sdkManifest).sort()).toEqual([
      'CradlePluginManifestError',
      'CradlePluginPackageJsonSchema',
      'CradlePluginPackageJsonTextSchema',
      'parseCradlePluginPackageJson',
      'parseCradlePluginPackageJsonText',
      'validatePluginEntryPath',
    ])
  })

  it('keeps host runtime files on manifest parser helpers', async () => {
    for (const file of runtimeManifestConsumers) {
      const source = await readFile(resolve(repoRoot, file), 'utf8')

      expect(source, `${file} should use the package text parser`).toContain(`parseCradlePlugin${'PackageJsonText'}`)
      expect(source, `${file} should not parse with schemas directly`).not.toContain('CradlePluginPackageJsonTextSchema')
    }
  })
})
