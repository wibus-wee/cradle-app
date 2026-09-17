import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { HttpArtifactDownloader } from '@cradle/download-center'
import { create as packTar } from 'tar'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { DownloadCenterService } from '../../download-center/service'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import { acquireProviderProcessHostResource } from '../kit/process-host'
import { prepareCodexManagedPathForRemoval } from './app-server/host-lease'
import { CODEX_RUNTIME_KIND } from './metadata'
import {
  CodexRuntimeInstallationService,
  resolveCodexAppServerExecutable,
} from './runtime-installation'
import type { ResolvedCodexReleaseTarget } from './runtime-release'
import type { CodexAppServerHostResource } from './types'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-codex-e2e-'))
  tempRoots.push(root)
  return root
}

/**
 * In-process fetch for the real `HttpArtifactDownloader`: serves fixture bytes
 * for an allow-list of `https://` URLs, including Range/ETag resume semantics.
 * Tests exercise the real downloader (streaming, checksum, artifact layout),
 * the real `DownloadCenterService` (SQLite tasks, queue, events), and the real
 * installation service — with zero network traffic and ~1 KB payloads.
 */
function fixtureFetch(fixtures: Record<string, Buffer>): typeof globalThis.fetch {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = fixtures[url]
    if (body === undefined) {
      return new Response(null, { status: 404 })
    }
    const etag = `"fixture-${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`
    const headers = new Headers(init?.headers)
    const range = headers.get('range')
    const ifRange = headers.get('if-range')
    if (range !== null && (ifRange === null || ifRange === etag)) {
      const match = range.match(/^bytes=(\d+)-(\d*)$/)
      const start = match ? Number(match[1]) : Number.NaN
      const end = match ? (match[2] === '' ? body.length - 1 : Number(match[2])) : Number.NaN
      if (!Number.isInteger(start) || !Number.isInteger(end) || start >= body.length || end >= body.length || end < start) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${body.length}` },
        })
      }
      const slice = body.subarray(start, end + 1)
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          'content-length': String(slice.length),
          'content-range': `bytes ${start}-${end}/${body.length}`,
          etag,
        },
      })
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { 'content-length': String(body.length), etag },
    })
  }
  return handler as typeof globalThis.fetch
}

function realDownloadCenter(fixtures: Record<string, Buffer>): DownloadCenterService {
  const rootDir = path.join(tempRoot(), 'downloads')
  return new DownloadCenterService({
    rootDir,
    downloader: new HttpArtifactDownloader({
      rootDir,
      fetch: fixtureFetch(fixtures),
      parallelConnections: 4,
      parallelMinBytes: 1,
    }),
  })
}

/** Tiny tar.gz containing a single fake executable payload. */
async function buildExecutableTarball(name: string, version: string): Promise<Buffer> {
  const pkgDir = path.join(tempRoot(), `pkg-${name}-${version}`)
  await mkdir(pkgDir, { recursive: true })
  await writeFile(path.join(pkgDir, name), `#!/bin/sh\necho ${name} ${version}\n`, 'utf8')
  const tarPath = path.join(tempRoot(), `${name}-${version}.tar.gz`)
  await packTar({ cwd: pkgDir, file: tarPath, gzip: true, prefix: 'pkg' }, [name])
  return await readFile(tarPath)
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function fakeAsset(name: string, tarball: Buffer, downloadUrl: string) {
  return {
    assetName: `${name}.tar.gz`,
    format: 'tar.gz' as const,
    sizeBytes: tarball.length,
    sha256: sha256Hex(tarball),
    downloadUrl,
    executableName: name,
    candidateBasenames: [name],
  }
}

function fakeTarget(version: string, appServer: ReturnType<typeof fakeAsset>, codeModeHost: ReturnType<typeof fakeAsset>): ResolvedCodexReleaseTarget {
  return {
    key: 'darwin-arm64',
    version,
    releaseTag: `rust-v${version}`,
    appServer,
    codeModeHost,
  }
}

afterEach(() => {
  providerRuntimeHostManager.clear()
})

afterAll(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('codex runtime managed lifecycle (real Download Center, fixture fetch)', () => {
  it('installs both executables, gates uninstall behind pooled host leases, and updates versions', async () => {
    const version = '0.155.0'
    const appServerUrl = 'https://fixtures.cradle.test/codex-app-server-0.155.0.tar.gz'
    const codeModeHostUrl = 'https://fixtures.cradle.test/codex-code-mode-host-0.155.0.tar.gz'
    const appServerTarball = await buildExecutableTarball('codex-app-server', version)
    const codeModeHostTarball = await buildExecutableTarball('codex-code-mode-host', version)
    const downloadCenter = realDownloadCenter({
      [appServerUrl]: appServerTarball,
      [codeModeHostUrl]: codeModeHostTarball,
    })
    await downloadCenter.boot()

    const env = { PATH: '' }
    const rootDir = path.join(tempRoot(), 'runtimes', 'codex-app-server', 'managed')
    const service = new CodexRuntimeInstallationService({
      downloadCenter,
      rootDir,
      env,
      target: fakeTarget(version, fakeAsset('codex-app-server', appServerTarball, appServerUrl), fakeAsset('codex-code-mode-host', codeModeHostTarball, codeModeHostUrl)),
      probeVersion: vi.fn(async () => version),
      prepareManagedPathForRemoval: prepareCodexManagedPathForRemoval,
    })
    await service.boot()

    await expect(service.status()).resolves.toMatchObject({
      state: 'missing',
      errorCode: 'codex_runtime_not_installed',
    })

    const installed = await service.install()
    expect(installed).toMatchObject({ state: 'ready', source: 'managed', version })
    const resolved = resolveCodexAppServerExecutable({ env, rootDir })
    expect(resolved).toMatchObject({ source: 'managed', version })
    expect(resolved!.command).toBe(path.join(rootDir, 'versions', version, 'bin', 'codex-app-server'))
    // Both executables land in the same bin dir so the app-server finds its
    // code-mode-host sibling.
    const { existsSync } = await import('node:fs')
    expect(existsSync(path.join(rootDir, 'versions', version, 'bin', 'codex-code-mode-host'))).toBe(true)

    // A pooled host leasing the managed executable blocks uninstall; the
    // still-running process is the source of truth.
    const disposeResource = vi.fn(async () => {})
    const hostLease = await acquireProviderProcessHostResource<CodexAppServerHostResource>({
      runtimeKind: CODEX_RUNTIME_KIND,
      providerTargetId: 'codex-provider',
      scopeId: 'provider-host:fixture-fingerprint',
      resourceFingerprint: 'fixture-fingerprint',
      retainOnRelease: true,
      createResource: () => ({
        client: { executablePath: resolved!.command },
      } as CodexAppServerHostResource),
      disposeResource,
    })
    await expect(service.uninstall()).rejects.toMatchObject({ code: 'codex_runtime_in_use' })

    // Releasing the lease leaves an idle host; removal invalidates (kills) it
    // first, then deletes the version.
    hostLease.release()
    await expect(service.uninstall()).resolves.toMatchObject({ managedInstalled: false })
    expect(disposeResource).toHaveBeenCalledOnce()

    // Update flow: install v1 again, then a service pinned to v2 reports
    // update-available, installs, and flips the current pointer.
    const v2 = '0.156.0'
    const appServerUrlV2 = 'https://fixtures.cradle.test/codex-app-server-0.156.0.tar.gz'
    const codeModeHostUrlV2 = 'https://fixtures.cradle.test/codex-code-mode-host-0.156.0.tar.gz'
    const appServerTarballV2 = await buildExecutableTarball('codex-app-server', v2)
    const codeModeHostTarballV2 = await buildExecutableTarball('codex-code-mode-host', v2)
    const updateCenter = realDownloadCenter({
      [appServerUrl]: appServerTarball,
      [codeModeHostUrl]: codeModeHostTarball,
      [appServerUrlV2]: appServerTarballV2,
      [codeModeHostUrlV2]: codeModeHostTarballV2,
    })
    await updateCenter.boot()
    const serviceV1 = new CodexRuntimeInstallationService({
      downloadCenter: updateCenter,
      rootDir,
      env,
      target: fakeTarget(version, fakeAsset('codex-app-server', appServerTarball, appServerUrl), fakeAsset('codex-code-mode-host', codeModeHostTarball, codeModeHostUrl)),
      probeVersion: vi.fn(async () => version),
    })
    await serviceV1.boot()
    await serviceV1.install()
    const serviceV2 = new CodexRuntimeInstallationService({
      downloadCenter: updateCenter,
      rootDir,
      env,
      target: fakeTarget(v2, fakeAsset('codex-app-server', appServerTarballV2, appServerUrlV2), fakeAsset('codex-code-mode-host', codeModeHostTarballV2, codeModeHostUrlV2)),
      probeVersion: vi.fn(async () => v2),
    })
    await serviceV2.boot()
    await expect(serviceV2.status()).resolves.toMatchObject({
      state: 'update-available',
      version,
      targetVersion: v2,
    })
    await expect(serviceV2.install()).resolves.toMatchObject({ state: 'ready', version: v2 })
    expect(resolveCodexAppServerExecutable({ env, rootDir }))
      .toMatchObject({ source: 'managed', version: v2 })

    await service.shutdown()
    await serviceV1.shutdown()
    await serviceV2.shutdown()
    await downloadCenter.shutdown()
    await updateCenter.shutdown()
  })

  it('fails closed on a checksum mismatch and leaves the resource missing', async () => {
    const version = '0.155.0'
    const appServerUrl = 'https://fixtures.cradle.test/codex-app-server-0.155.0.tar.gz'
    const codeModeHostUrl = 'https://fixtures.cradle.test/codex-code-mode-host-0.155.0.tar.gz'
    const appServerTarball = await buildExecutableTarball('codex-app-server', version)
    const codeModeHostTarball = await buildExecutableTarball('codex-code-mode-host', version)
    const downloadCenter = realDownloadCenter({
      [appServerUrl]: appServerTarball,
      [codeModeHostUrl]: codeModeHostTarball,
    })
    await downloadCenter.boot()

    const badAppServer = { ...fakeAsset('codex-app-server', appServerTarball, appServerUrl), sha256: '0'.repeat(64) }
    const service = new CodexRuntimeInstallationService({
      downloadCenter,
      rootDir: path.join(tempRoot(), 'runtimes', 'codex-app-server', 'managed'),
      env: { PATH: '' },
      target: fakeTarget(version, badAppServer, fakeAsset('codex-code-mode-host', codeModeHostTarball, codeModeHostUrl)),
      probeVersion: vi.fn(async () => version),
    })
    await service.boot()
    await expect(service.install()).rejects.toThrow()
    await expect(service.status()).resolves.toMatchObject({ managedInstalled: false })
    await service.shutdown()
    await downloadCenter.shutdown()
  })

  it('refuses install while the configured app-server override is active', async () => {
    const downloadCenter = realDownloadCenter({})
    await downloadCenter.boot()
    const service = new CodexRuntimeInstallationService({
      downloadCenter,
      rootDir: tempRoot(),
      env: { CRADLE_CODEX_APP_SERVER_PATH: '/operator/codex-app-server', PATH: '' },
      target: fakeTarget('0.155.0', fakeAsset('codex-app-server', Buffer.from('x'), 'https://fixtures.cradle.test/unused-a.tar.gz'), fakeAsset('codex-code-mode-host', Buffer.from('x'), 'https://fixtures.cradle.test/unused-b.tar.gz')),
    })
    await service.boot()
    expect(() => service.install()).toThrow(expect.objectContaining({ code: 'codex_runtime_override_active' }))
    await service.shutdown()
    await downloadCenter.shutdown()
  })
})
