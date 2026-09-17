import { mkdtempSync, rmSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppError } from '../../../errors/app-error'
import {
  applyClaudeAgentExecutableToQueryOptions,
  CLAUDE_CODE_PATH_ENV,
  isManagedClaudeExecutablePath,
  prepareClaudeManagedPathForRemoval,
  readClaudeManagedExecutableLeaseCount,
  resolveClaudeAgentExecutable,
  resolveClaudeManagedExecutablePath,
  trackClaudeManagedQuery,
} from './runtime-executable'

const tempRoots: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-claude-runtime-'))
  tempRoots.push(root)
  return root
}

async function writeManagedInstall(rootDir: string, version: string): Promise<string> {
  const executable = path.join(rootDir, 'versions', version, 'bin', 'claude')
  await mkdir(path.dirname(executable), { recursive: true })
  await writeFile(executable, 'fixture')
  await chmod(executable, 0o755)
  const manifest = {
    schemaVersion: 1,
    version,
    targetKey: 'darwin-arm64',
    executablePath: path.join('versions', version, 'bin', 'claude'),
    sha512: 'a'.repeat(128),
    installedAt: '2026-09-16T00:00:00.000Z',
  }
  await writeFile(path.join(rootDir, 'versions', version, 'installation.json'), JSON.stringify(manifest))
  await writeFile(path.join(rootDir, 'current.json'), JSON.stringify(manifest))
  return executable
}

describe('resolveClaudeAgentExecutable', () => {
  it('prefers the configured override, then managed, then sdk-bundled, then PATH', async () => {
    const rootDir = tempRoot()
    const env = { [CLAUDE_CODE_PATH_ENV]: '/operator/claude', PATH: '' }
    expect(resolveClaudeAgentExecutable({ env, rootDir }))
      .toMatchObject({ source: 'configured', path: '/operator/claude' })

    const managedPath = await writeManagedInstall(rootDir, '0.3.261')
    expect(resolveClaudeAgentExecutable({ env: { PATH: '' }, rootDir }))
      .toMatchObject({ source: 'managed', path: managedPath, version: '0.3.261', managed: true })
    expect(resolveClaudeManagedExecutablePath({ rootDir })).toBe(managedPath)

    // sdk-bundled leaves the concrete path unset so the SDK self-resolves.
    expect(resolveClaudeAgentExecutable({
      env: { PATH: '' },
      rootDir: tempRoot(),
      sdkBundledPath: '/sdk/claude',
    })).toMatchObject({ source: 'sdk-bundled', path: null })

    const pathDir = tempRoot()
    const onPath = path.join(pathDir, 'claude')
    await writeFile(onPath, 'cli')
    await chmod(onPath, 0o755)
    expect(resolveClaudeAgentExecutable({ env: { PATH: pathDir }, rootDir: tempRoot(), sdkBundledPath: null }))
      .toMatchObject({ source: 'path', path: onPath })

    expect(resolveClaudeAgentExecutable({ env: { PATH: '' }, rootDir: tempRoot(), sdkBundledPath: null }))
      .toBeNull()
  })

  it('throws claude_agent_runtime_not_installed when nothing resolves', () => {
    expect(() => applyClaudeAgentExecutableToQueryOptions({}, {
      env: { PATH: '' },
      rootDir: tempRoot(),
      sdkBundledPath: null,
    })).toThrowError(expect.objectContaining({
      code: 'claude_agent_runtime_not_installed',
    }) as AppError)
  })

  it('sets pathToClaudeCodeExecutable for concrete sources and leaves sdk-bundled unset', async () => {
    const rootDir = tempRoot()
    const managedPath = await writeManagedInstall(rootDir, '0.3.261')
    const options: { pathToClaudeCodeExecutable?: string } = {}
    applyClaudeAgentExecutableToQueryOptions(options, { env: { PATH: '' }, rootDir })
    expect(options.pathToClaudeCodeExecutable).toBe(managedPath)

    const bundled: { pathToClaudeCodeExecutable?: string } = {}
    applyClaudeAgentExecutableToQueryOptions(bundled, {
      env: { PATH: '' },
      rootDir: tempRoot(),
      sdkBundledPath: '/sdk/claude',
    })
    expect(bundled.pathToClaudeCodeExecutable).toBeUndefined()
  })
})

describe('trackClaudeManagedQuery', () => {
  it('holds a lease on the managed path until close() runs', async () => {
    const dataDir = tempRoot()
    vi.stubEnv('CRADLE_DATA_DIR', dataDir)
    const managedRoot = path.join(dataDir, 'runtimes', 'claude-agent', 'managed')
    const managedPath = await writeManagedInstall(managedRoot, '0.3.261')
    expect(isManagedClaudeExecutablePath(managedPath)).toBe(true)
    expect(isManagedClaudeExecutablePath(path.join(tempRoot(), 'claude'))).toBe(false)

    const tracked = trackClaudeManagedQuery({ close: () => undefined }, { pathToClaudeCodeExecutable: managedPath })
    expect(readClaudeManagedExecutableLeaseCount(managedPath)).toBe(1)
    await expect(prepareClaudeManagedPathForRemoval(managedPath)).resolves.toBe(false)

    tracked.close()
    expect(readClaudeManagedExecutableLeaseCount(managedPath)).toBe(0)
    await expect(prepareClaudeManagedPathForRemoval(managedPath)).resolves.toBe(true)
  })

  it('ignores non-managed paths', async () => {
    const tracked = trackClaudeManagedQuery({ close: () => undefined }, { pathToClaudeCodeExecutable: '/usr/bin/claude' })
    expect(readClaudeManagedExecutableLeaseCount('/usr/bin/claude')).toBe(0)
    tracked.close()
    await expect(prepareClaudeManagedPathForRemoval('/usr/bin/claude')).resolves.toBe(true)
  })
})
