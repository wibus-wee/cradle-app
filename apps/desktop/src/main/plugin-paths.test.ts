/* Tests desktop plugin directory resolution for dev chunks and packaged resources. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveDesktopPrimaryPluginsDir, resolveDesktopPrimaryPluginsSourceKind } from './plugin-paths'

const tempRoots: string[] = []

function createWorkspaceFixture(): { root: string, chunkDir: string, pluginsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cradle-desktop-plugin-paths-'))
  tempRoots.push(root)
  const pluginsDir = join(root, 'plugins')
  const chunkDir = join(root, 'apps', 'desktop', 'dist', 'main', 'chunks')
  mkdirSync(pluginsDir, { recursive: true })
  mkdirSync(chunkDir, { recursive: true })
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - plugins/*\n')
  return { root, chunkDir, pluginsDir }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveDesktopPrimaryPluginsDir', () => {
  it('uses CRADLE_PLUGINS_DIR when configured', () => {
    const configuredDir = join(tmpdir(), 'cradle-configured-plugins')

    expect(resolveDesktopPrimaryPluginsDir({
      env: { CRADLE_PLUGINS_DIR: configuredDir },
      isDev: true,
      moduleDir: join(tmpdir(), 'dist', 'main', 'chunks'),
    })).toBe(configuredDir)
  })

  it('finds the workspace plugins directory from an electron-vite chunk directory', () => {
    const fixture = createWorkspaceFixture()

    expect(resolveDesktopPrimaryPluginsDir({
      cwd: join(fixture.root, 'apps', 'desktop'),
      env: {},
      isDev: true,
      moduleDir: fixture.chunkDir,
    })).toBe(fixture.pluginsDir)
  })

  it('uses packaged resources when running outside development', () => {
    const resourcesPath = join(tmpdir(), 'Cradle.app', 'Contents', 'Resources')

    expect(resolveDesktopPrimaryPluginsDir({
      env: {},
      isDev: false,
      resourcesPath,
    })).toBe(join(resourcesPath, 'server', 'plugins'))
  })
})

describe('resolveDesktopPrimaryPluginsSourceKind', () => {
  it('classifies development workspace plugins separately from bundled resources', () => {
    expect(resolveDesktopPrimaryPluginsSourceKind({ env: {}, isDev: true })).toBe('workspaceDev')
    expect(resolveDesktopPrimaryPluginsSourceKind({ env: {}, isDev: false })).toBe('bundledResource')
  })

  it('classifies CRADLE_PLUGINS_DIR as operator-selected local plugins', () => {
    expect(resolveDesktopPrimaryPluginsSourceKind({
      env: { CRADLE_PLUGINS_DIR: join(tmpdir(), 'cradle-configured-plugins') },
      isDev: false,
    })).toBe('externalLocal')
  })
})
