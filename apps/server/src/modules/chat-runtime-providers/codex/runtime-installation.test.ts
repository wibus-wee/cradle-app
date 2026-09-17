import { mkdtempSync, rmSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodexRuntimeDownloadCenter } from './runtime-installation'
import {
  CodexRuntimeInstallationService,
  resolveCodexAppServerExecutable,
  resolveCodexManagedAppServerPath,
} from './runtime-installation'
import { resolveCodexReleaseTarget } from './runtime-release'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-codex-runtime-'))
  tempRoots.push(root)
  return root
}

function fakeDownloadCenter() {
  const requests: DownloadRequest[] = []
  const artifactsByFileName = new Map<string, DownloadedArtifact>()
  const service: CodexRuntimeDownloadCenter = {
    execute: vi.fn(async (request) => {
      requests.push(request)
      const artifact: DownloadedArtifact = {
        taskId: `task-${requests.length}`,
        filePath: `/fake/${request.fileName}`,
        bytes: 1,
        checksum: { algorithm: 'sha256', expected: null, actual: 'a'.repeat(64), matched: null },
      }
      artifactsByFileName.set(request.fileName, artifact)
      return artifact
    }),
    retry: vi.fn(async (_taskId, request) => {
      requests.push(request)
      const artifact: DownloadedArtifact = {
        taskId: `retry-${requests.length}`,
        filePath: `/fake/${request.fileName}`,
        bytes: 1,
        checksum: { algorithm: 'sha256', expected: null, actual: 'a'.repeat(64), matched: null },
      }
      return artifact
    }),
    release: vi.fn(async () => undefined),
    findLatestRetryable: vi.fn(() => null),
  }
  return { service, requests, artifactsByFileName }
}

function fakeExtractExecutable() {
  return async (_archivePath: string, asset: { executableName: string }, destination: string) => {
    const executable = path.join(destination, asset.executableName)
    await mkdir(destination, { recursive: true })
    await writeFile(executable, 'fixture')
    return executable
  }
}

describe('codexRuntimeInstallationService', () => {
  it('installs both runtime assets atomically with the catalog identity and resolves the managed binary', async () => {
    const rootDir = tempRoot()
    const target = resolveCodexReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const download = fakeDownloadCenter()
    const prepareRemoval = vi.fn(async () => true)
    const service = new CodexRuntimeInstallationService({
      downloadCenter: download.service,
      rootDir,
      env: { PATH: '' },
      target,
      probeVersion: vi.fn(async () => target.version),
      prepareManagedPathForRemoval: prepareRemoval,
      extractExecutable: fakeExtractExecutable(),
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    })
    await service.boot()

    await expect(service.install()).resolves.toMatchObject({
      state: 'ready',
      source: 'managed',
      version: target.version,
      managedInstalled: true,
    })
    expect(download.requests).toHaveLength(2)
    expect(download.requests.map(request => request.fileName).sort()).toEqual([
      target.appServer.assetName,
      target.codeModeHost.assetName,
    ].sort())
    for (const request of download.requests) {
      expect(request.owner).toEqual({
        namespace: 'codex',
        resourceType: 'runtime',
        resourceId: 'app-server',
        displayName: 'Codex app-server',
      })
    }
    expect(download.service.release).toHaveBeenCalledTimes(2)

    const managedPath = resolveCodexManagedAppServerPath({ rootDir })
    expect(managedPath).toBe(path.join(rootDir, 'versions', target.version, 'bin', target.appServer.executableName))
    expect(resolveCodexAppServerExecutable({ env: { PATH: '' }, rootDir }))
      .toMatchObject({ source: 'managed', command: managedPath, version: target.version, managed: true })

    await expect(service.uninstall()).resolves.toMatchObject({
      managedInstalled: false,
      state: 'missing',
    })
    expect(prepareRemoval).toHaveBeenCalled()
  })

  it('preserves configured overrides and refuses removal while a managed binary is leased', async () => {
    const target = resolveCodexReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const override = new CodexRuntimeInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir: tempRoot(),
      env: { CRADLE_CODEX_APP_SERVER_PATH: '/operator/codex-app-server', PATH: '' },
      target,
    })
    expect(() => override.install()).toThrow(expect.objectContaining({ code: 'codex_runtime_override_active' }))

    const service = new CodexRuntimeInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir: tempRoot(),
      env: { PATH: '' },
      target,
      probeVersion: vi.fn(async () => target.version),
      prepareManagedPathForRemoval: vi.fn(async () => false),
      extractExecutable: fakeExtractExecutable(),
    })
    await service.boot()
    await service.install()
    await expect(service.uninstall()).rejects.toMatchObject({ code: 'codex_runtime_in_use' })
  })

  it('releases both Download Center artifacts and retains error state when extraction fails', async () => {
    const target = resolveCodexReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const download = fakeDownloadCenter()
    const service = new CodexRuntimeInstallationService({
      downloadCenter: download.service,
      rootDir: tempRoot(),
      env: { PATH: '' },
      target,
      extractExecutable: vi.fn(async () => { throw new Error('unsafe archive') }),
    })
    await service.boot()
    await expect(service.install()).rejects.toThrow('unsafe archive')
    expect(download.service.release).toHaveBeenCalledTimes(2)
    await expect(service.status()).resolves.toMatchObject({
      state: 'error',
      errorCode: 'codex_runtime_install_failed',
    })
  })

  it('reports missing when no executable resolves, and path/cli sources for external fallbacks', async () => {
    const target = resolveCodexReleaseTarget({ platform: 'darwin', arch: 'arm64' })!
    const rootDir = tempRoot()
    const pathDir = tempRoot()
    const pathAppServer = path.join(pathDir, 'codex-app-server')
    const pathCliDir = tempRoot()
    const pathCli = path.join(pathCliDir, 'codex')
    await writeFile(pathAppServer, 'app-server')
    await writeFile(pathCli, 'cli')
    await chmod(pathAppServer, 0o755)
    await chmod(pathCli, 0o755)

    const service = new CodexRuntimeInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir,
      env: { PATH: '' },
      target,
    })
    await service.boot()
    await expect(service.status()).resolves.toMatchObject({
      state: 'missing',
      errorCode: 'codex_runtime_not_installed',
    })

    expect(resolveCodexAppServerExecutable({ env: { PATH: pathDir }, rootDir }))
      .toMatchObject({ source: 'path', command: pathAppServer })
    expect(resolveCodexAppServerExecutable({ env: { PATH: pathCliDir }, rootDir }))
      .toMatchObject({ source: 'cli', command: pathCli })
    expect(resolveCodexAppServerExecutable({ env: { PATH: '' }, rootDir })).toBeNull()
  })
})
