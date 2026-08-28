import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { pluginInstallInternals } from './plugin-install'

const tempRoots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cradle-plugin-install-'))
  tempRoots.push(root)
  return root
}

describe('plugin install command', () => {
  afterEach(async () => {
    for (const root of tempRoots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs the package build script as a finite process', async () => {
    const packageDir = await tempRoot()
    await mkdir(resolve(packageDir, 'dist'), { recursive: true })
    await writeFile(resolve(packageDir, 'package.json'), `${JSON.stringify({
      name: '@acme/finite-plugin',
      version: '1.0.0',
      type: 'module',
      scripts: {
        build: "node -e \"require('fs').writeFileSync('dist/server.mjs', 'export function activate() {}\\\\n')\"",
      },
      cradle: {
        apiVersion: '1',
        server: 'dist/server.mjs',
        contributes: { capabilities: [], permissions: [] },
      },
    }, null, 2)}\n`, 'utf8')

    await pluginInstallInternals.runPackageBuild(packageDir)

    await expect(readFile(resolve(packageDir, 'dist/server.mjs'), 'utf8')).resolves.toBe(
      'export function activate() {}\n',
    )
  })

  it('rejects a package without an explicit build script', async () => {
    const packageDir = await tempRoot()
    await writeFile(resolve(packageDir, 'package.json'), `${JSON.stringify({
      name: '@acme/unbuilt-plugin',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: 'dist/server.mjs',
        contributes: { capabilities: [], permissions: [] },
      },
    }, null, 2)}\n`, 'utf8')

    await expect(pluginInstallInternals.runPackageBuild(packageDir)).rejects.toThrow(
      'Plugin package must declare a build script',
    )
  })
})
