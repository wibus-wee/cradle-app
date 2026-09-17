import { mkdtempSync, rmSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DownloadRequest } from '@cradle/download-center'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLAUDE_CODE_PATH_ENV, resolveClaudeAgentExecutable } from './runtime-executable'
import type { ClaudeCodeRuntimeDownloadCenter } from './runtime-installation'
import { ClaudeCodeRuntimeInstallationService } from './runtime-installation'
import { resolveClaudeCodeReleaseTarget } from './runtime-release'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-claude-runtime-'))
  tempRoots.push(root)
  return root
}

function fakeDownloadCenter() {
  const requests: DownloadRequest[] = []
  const service: ClaudeCodeRuntimeDownloadCenter = {
    execute: vi.fn(async (request) => {
      requests.push(request)
      return {
        taskId: `task-${requests.length}`,
        filePath: `/fake/${request.fileName}`,
        bytes: 1,
        checksum: { algorithm: 'sha512' as const, expected: null, actual: 'a'.repeat(128), matched: null },
      }
    }),
    retry: vi.fn(async (_taskId, request) => {
      requests.push(request)
      return {
        taskId: `retry-${requests.length}`,
        filePath: `/fake/${request.fileName}`,
        bytes: 1,
        checksum: { algorithm: 'sha512' as const, expected: null, actual: 'a'.repeat(128), matched: null },
      }
    }),
    release: vi.fn(async () => undefined),
    findLatestRetryable: vi.fn(() => null),
  }
  return { service, requests }
}

function fakeExtractExecutable() {
  return async (_archivePath: string, target: { executableName: string }, destination: string) => {
    const executable = path.join(destination, target.executableName)
    await mkdir(destination, { recursive: true })
    await writeFile(executable, 'fixture')
    return executable
  }
}

describe('claudeCodeRuntimeInstallationService', () => {
  it('installs the platform package tarball with the catalog identity and resolves the managed binary', async () => {
    const rootDir = tempRoot()
    const target = resolveClaudeCodeReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const download = fakeDownloadCenter()
    const prepareRemoval = vi.fn(async () => true)
    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: download.service,
      rootDir,
      env: { PATH: '' },
      target,
      resolveExecutable: input => resolveClaudeAgentExecutable({ ...input, sdkBundledPath: null }),
      probeVersion: vi.fn(async () => target.version),
      prepareManagedPathForRemoval: prepareRemoval,
      extractExecutable: fakeExtractExecutable(),
      now: () => new Date('2026-09-16T00:00:00.000Z'),
    })
    await service.boot()

    await expect(service.install()).resolves.toMatchObject({
      state: 'ready',
      source: 'managed',
      version: target.version,
      managedInstalled: true,
    })
    expect(download.requests).toHaveLength(1)
    expect(download.requests[0]).toMatchObject({
      fileName: `claude-agent-sdk-darwin-arm64-${target.version}.tgz`,
      owner: {
        namespace: 'claude-agent',
        resourceType: 'runtime',
        resourceId: 'cli',
        displayName: 'Claude Code runtime',
      },
      integrity: { checksum: { algorithm: 'sha512', value: target.sha512 } },
    })
    expect(download.service.release).toHaveBeenCalledTimes(1)

    await expect(service.uninstall()).resolves.toMatchObject({
      managedInstalled: false,
      state: 'missing',
    })
    expect(prepareRemoval).toHaveBeenCalled()
  })

  it('refuses install while a configured override is active, and refuses removal while leased', async () => {
    const target = resolveClaudeCodeReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const override = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir: tempRoot(),
      env: { [CLAUDE_CODE_PATH_ENV]: '/operator/claude', PATH: '' },
      target,
    })
    expect(() => override.install()).toThrow(expect.objectContaining({ code: 'claude_agent_runtime_override_active' }))

    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir: tempRoot(),
      env: { PATH: '' },
      target,
      resolveExecutable: input => resolveClaudeAgentExecutable({ ...input, sdkBundledPath: null }),
      probeVersion: vi.fn(async () => target.version),
      prepareManagedPathForRemoval: vi.fn(async () => false),
      extractExecutable: fakeExtractExecutable(),
    })
    await service.boot()
    await service.install()
    await expect(service.uninstall()).rejects.toMatchObject({ code: 'claude_agent_runtime_in_use' })
  })

  it('releases the Download Center artifact and retains error state when extraction fails', async () => {
    const target = resolveClaudeCodeReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const download = fakeDownloadCenter()
    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: download.service,
      rootDir: tempRoot(),
      env: { PATH: '' },
      target,
      resolveExecutable: input => resolveClaudeAgentExecutable({ ...input, sdkBundledPath: null }),
      extractExecutable: vi.fn(async () => { throw new Error('unsafe archive') }),
    })
    await service.boot()
    await expect(service.install()).rejects.toThrow('unsafe archive')
    expect(download.service.release).toHaveBeenCalledTimes(1)
    await expect(service.status()).resolves.toMatchObject({
      state: 'error',
      errorCode: 'claude_agent_runtime_install_failed',
    })
  })

  it('reports missing when nothing resolves and sdk-bundled/path as external sources', async () => {
    const target = resolveClaudeCodeReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const rootDir = tempRoot()
    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir,
      env: { PATH: '' },
      target,
      resolveExecutable: input => resolveClaudeAgentExecutable({ ...input, sdkBundledPath: null }),
    })
    await service.boot()
    await expect(service.status()).resolves.toMatchObject({
      state: 'missing',
      errorCode: 'claude_agent_runtime_not_installed',
    })

    expect(resolveClaudeAgentExecutable({ env: { PATH: '' }, rootDir, sdkBundledPath: '/sdk/claude' }))
      .toMatchObject({ source: 'sdk-bundled', path: null })

    const pathDir = tempRoot()
    const onPath = path.join(pathDir, 'claude')
    await writeFile(onPath, 'cli')
    await chmod(onPath, 0o755)
    expect(resolveClaudeAgentExecutable({ env: { PATH: pathDir }, rootDir, sdkBundledPath: null }))
      .toMatchObject({ source: 'path', path: onPath })
  })
})
