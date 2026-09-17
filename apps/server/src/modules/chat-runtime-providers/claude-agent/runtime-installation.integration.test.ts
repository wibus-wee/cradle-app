import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { HttpArtifactDownloader } from '@cradle/download-center'
import { create as packTar } from 'tar'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { DownloadCenterService } from '../../download-center/service'
import {
  applyClaudeAgentExecutableToQueryOptions,
  CLAUDE_CODE_PATH_ENV,
  defaultClaudeRuntimeRoot,
  prepareClaudeManagedPathForRemoval,
  resolveClaudeAgentExecutable,
  trackClaudeManagedQuery,
} from './runtime-executable'
import { ClaudeCodeRuntimeInstallationService } from './runtime-installation'
import type { ResolvedClaudeCodeReleaseTarget } from './runtime-release'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-claude-e2e-'))
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

/** Tiny npm-shaped tarball: `package/claude` plus `package/package.json`. */
async function buildClaudeTarball(version: string): Promise<Buffer> {
  const pkgDir = path.join(tempRoot(), `pkg-${version}`)
  await mkdir(pkgDir, { recursive: true })
  await writeFile(path.join(pkgDir, 'claude'), `#!/bin/sh\necho ${version}\n`, 'utf8')
  await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'fake-claude', version }), 'utf8')
  const tarPath = path.join(tempRoot(), `claude-${version}.tgz`)
  await packTar({ cwd: pkgDir, file: tarPath, gzip: true, prefix: 'package' }, ['claude', 'package.json'])
  return await readFile(tarPath)
}

function sha512Hex(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex')
}

function fakeTarget(version: string, downloadUrl: string, sha512: string): ResolvedClaudeCodeReleaseTarget {
  return {
    key: 'darwin-arm64',
    packageName: `@anthropic-ai/claude-agent-sdk-darwin-arm64`,
    version,
    downloadUrl,
    executableName: 'claude',
    unpackedSizeBytes: 1024,
    sha512,
  }
}

function noSdkBundled(input: Parameters<typeof resolveClaudeAgentExecutable>[0]) {
  return resolveClaudeAgentExecutable({ ...input, sdkBundledPath: null })
}

afterAll(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('claude runtime managed lifecycle (real Download Center, fixture fetch)', () => {
  it('installs, gates uninstall behind a live Query lease, and updates versions', async () => {
    const v1Tarball = await buildClaudeTarball('9.0.0')
    const v1Url = 'https://fixtures.cradle.test/claude-9.0.0.tgz'
    const downloadCenter = realDownloadCenter({ [v1Url]: v1Tarball })
    await downloadCenter.boot()

    // Managed root must match the process-env default so
    // isManagedClaudeExecutablePath recognizes the leased binary.
    const env = { PATH: '' }
    const rootUnderDataDir = defaultClaudeRuntimeRoot()

    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter,
      rootDir: rootUnderDataDir,
      env,
      target: fakeTarget('9.0.0', v1Url, sha512Hex(v1Tarball)),
      resolveExecutable: noSdkBundled,
      probeVersion: vi.fn(async () => '9.0.0'),
      prepareManagedPathForRemoval: prepareClaudeManagedPathForRemoval,
    })
    await service.boot()

    await expect(service.status()).resolves.toMatchObject({
      state: 'missing',
      errorCode: 'claude_agent_runtime_not_installed',
    })

    const installed = await service.install()
    expect(installed).toMatchObject({ state: 'ready', source: 'managed', version: '9.0.0' })

    // The query options seam injects the managed binary path.
    const options: { pathToClaudeCodeExecutable?: string } = {}
    const resolved = applyClaudeAgentExecutableToQueryOptions(options, {
      env,
      rootDir: rootUnderDataDir,
      sdkBundledPath: null,
    })
    expect(resolved).toMatchObject({ source: 'managed' })
    const managedExecutable = options.pathToClaudeCodeExecutable!
    expect(managedExecutable).toBe(path.join(rootUnderDataDir, 'versions', '9.0.0', 'bin', 'claude'))

    // A live query leasing the binary blocks uninstall until close().
    const closeSpy = vi.fn()
    const query = trackClaudeManagedQuery({ close: closeSpy }, options)
    await expect(service.uninstall()).rejects.toMatchObject({ code: 'claude_agent_runtime_in_use' })
    query.close!()
    await expect(service.uninstall()).resolves.toMatchObject({ managedInstalled: false })
    expect(closeSpy).toHaveBeenCalledOnce()

    // Reinstall v1, then update to v2: the current pointer flips while the
    // v1 version dir stays for any in-flight process still holding it.
    const v2Tarball = await buildClaudeTarball('9.1.0')
    const v2Url = 'https://fixtures.cradle.test/claude-9.1.0.tgz'
    const updateCenter = realDownloadCenter({ [v1Url]: v1Tarball, [v2Url]: v2Tarball })
    await updateCenter.boot()
    const serviceV1 = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: updateCenter,
      rootDir: rootUnderDataDir,
      env,
      target: fakeTarget('9.0.0', v1Url, sha512Hex(v1Tarball)),
      resolveExecutable: noSdkBundled,
      probeVersion: vi.fn(async () => '9.0.0'),
    })
    await serviceV1.boot()
    await serviceV1.install()
    const serviceV2 = new ClaudeCodeRuntimeInstallationService({
      downloadCenter: updateCenter,
      rootDir: rootUnderDataDir,
      env,
      target: fakeTarget('9.1.0', v2Url, sha512Hex(v2Tarball)),
      resolveExecutable: noSdkBundled,
      probeVersion: vi.fn(async () => '9.1.0'),
    })
    await serviceV2.boot()
    await expect(serviceV2.status()).resolves.toMatchObject({
      state: 'update-available',
      version: '9.0.0',
      targetVersion: '9.1.0',
    })
    await expect(serviceV2.install()).resolves.toMatchObject({ state: 'ready', version: '9.1.0' })
    expect(resolveClaudeAgentExecutable({ env, rootDir: rootUnderDataDir, sdkBundledPath: null }))
      .toMatchObject({ source: 'managed', version: '9.1.0' })

    await service.shutdown()
    await serviceV1.shutdown()
    await serviceV2.shutdown()
    await downloadCenter.shutdown()
    await updateCenter.shutdown()
  })

  it('fails closed on a checksum mismatch and leaves the resource missing', async () => {
    const tarball = await buildClaudeTarball('9.0.0')
    const url = 'https://fixtures.cradle.test/claude-9.0.0.tgz'
    const downloadCenter = realDownloadCenter({ [url]: tarball })
    await downloadCenter.boot()

    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter,
      rootDir: path.join(tempRoot(), 'runtimes', 'claude-agent', 'managed'),
      env: { PATH: '' },
      target: fakeTarget('9.0.0', url, '0'.repeat(128)),
      resolveExecutable: noSdkBundled,
      probeVersion: vi.fn(async () => '9.0.0'),
    })
    await service.boot()
    await expect(service.install()).rejects.toThrow()
    await expect(service.status()).resolves.toMatchObject({ managedInstalled: false })
    await service.shutdown()
    await downloadCenter.shutdown()
  })

  it('refuses install while the configured executable override is active', async () => {
    const downloadCenter = realDownloadCenter({})
    await downloadCenter.boot()
    const service = new ClaudeCodeRuntimeInstallationService({
      downloadCenter,
      rootDir: tempRoot(),
      env: { [CLAUDE_CODE_PATH_ENV]: '/operator/claude', PATH: '' },
      target: fakeTarget('9.0.0', 'https://fixtures.cradle.test/unused.tgz', '0'.repeat(128)),
    })
    await service.boot()
    expect(() => service.install()).toThrow(expect.objectContaining({ code: 'claude_agent_runtime_override_active' }))
    await service.shutdown()
    await downloadCenter.shutdown()
  })
})
