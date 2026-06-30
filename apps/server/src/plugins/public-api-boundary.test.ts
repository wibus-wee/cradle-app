import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

const publicSdkFiles = [
  'packages/plugin-sdk/src/server.ts',
  'packages/plugin-sdk/src/web.ts',
  'packages/plugin-sdk/src/desktop.ts',
]

const firstPartyPluginFiles = [
  'plugins/system-info/src/server.ts',
  'plugins/system-info/src/web.tsx',
  'plugins/browser-use/src/desktop.ts',
]

const hostManifestConsumers = [
  'apps/server/src/plugins/discovery.ts',
  'apps/desktop/src/main/plugin-discovery.ts',
  'apps/desktop/src/main/plugin-install-links.ts',
]

const legacyPublicApiMarkers = [
  'app: unknown',
  'app?: unknown',
  'ctx.app',
  'context.app',
  'registerMcpServer',
  'registerSkill',
  'registerPanel',
  'registerCommand',
  'onWebviewCreated',
  'setSharedConfig',
  'requestBrowserTab',
  'activateBrowserTab',
  'getActiveBrowserTab',
]

describe('plugin SDK public API boundary', () => {
  it('does not expose host app or flat compatibility APIs from public SDK contexts', async () => {
    for (const file of publicSdkFiles) {
      const source = await readFile(resolve(repoRoot, file), 'utf8')

      for (const marker of legacyPublicApiMarkers) {
        expect(source, `${file} should not expose ${marker}`).not.toContain(marker)
      }
    }
  })

  it('keeps first-party plugins on namespace APIs', async () => {
    for (const file of firstPartyPluginFiles) {
      const source = await readFile(resolve(repoRoot, file), 'utf8')

      for (const marker of legacyPublicApiMarkers) {
        expect(source, `${file} should not call ${marker}`).not.toContain(marker)
      }
    }
  })

  it('keeps host manifest consumers on SDK manifest parser APIs', async () => {
    for (const file of hostManifestConsumers) {
      const source = await readFile(resolve(repoRoot, file), 'utf8')

      expect(source, `${file} should use the manifest text parser`).toContain(`parseCradlePlugin${'PackageJsonText'}`)
      expect(source, `${file} should not use Zod schemas directly`).not.toContain('CradlePluginPackageJsonTextSchema')
    }
  })
})
