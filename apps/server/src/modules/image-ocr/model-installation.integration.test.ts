import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { HttpArtifactDownloader } from '@cradle/download-center'
import { create as packTar } from 'tar'
import { afterAll, describe, expect, it } from 'vitest'

import { DownloadCenterService } from '../download-center/service'
import {
  LIGHT_OCR_BUNDLE_PATH_ENV,
  prepareOcrModelManagedPathForRemoval,
  registerOcrEngineLease,
  resolveOcrModelBundle,
} from './model-bundle'
import { OcrModelInstallationService } from './model-installation'
import type { ResolvedOcrModelRelease } from './model-release'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-ocr-e2e-'))
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

/**
 * Build a real npm-shaped tarball (`package/bundle/...` + decoy files) on disk
 * and return its bytes — a few KB instead of the real 70 MB download.
 */
async function buildModelTarball(version: string): Promise<Buffer> {
  const pkgDir = path.join(tempRoot(), `pkg-${version}`)
  await mkdir(path.join(pkgDir, 'bundle', 'det'), { recursive: true })
  await mkdir(path.join(pkgDir, 'bundle', 'rec'), { recursive: true })
  await writeFile(path.join(pkgDir, 'bundle', 'manifest.json'), JSON.stringify({ bundleId: `test-${version}` }), 'utf8')
  await writeFile(path.join(pkgDir, 'bundle', 'det', 'model.bin'), `det-${version}`, 'utf8')
  await writeFile(path.join(pkgDir, 'bundle', 'rec', 'model.bin'), `rec-${version}`, 'utf8')
  await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'fake-ocr-model', version }), 'utf8')
  await writeFile(path.join(pkgDir, 'README.md'), 'decoy payload the extractor must ignore', 'utf8')
  const tarPath = path.join(tempRoot(), `model-${version}.tgz`)
  await packTar({ cwd: pkgDir, file: tarPath, gzip: true, prefix: 'package' }, [
    'bundle/manifest.json',
    'bundle/det/model.bin',
    'bundle/rec/model.bin',
    'package.json',
    'README.md',
  ])
  const { readFile } = await import('node:fs/promises')
  return await readFile(tarPath)
}

function sha512Hex(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex')
}

function fakeTarget(version: string, downloadUrl: string, sha512: string): ResolvedOcrModelRelease {
  return {
    packageName: '@arcships/light-ocr-model-ppocrv6-small',
    version,
    bundleId: `test-${version}`,
    downloadUrl,
    unpackedSizeBytes: 1024,
    sha512,
  }
}

function noBundled(input: Parameters<typeof resolveOcrModelBundle>[0]) {
  return resolveOcrModelBundle({ ...input, bundledPath: null })
}

afterAll(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('ocr model managed lifecycle (real Download Center, fixture fetch)', () => {
  it('installs a real download, closes the leased engine on uninstall, and updates versions', async () => {
    const v1Tarball = await buildModelTarball('1.0.0')
    const v1Url = 'https://fixtures.cradle.test/model-1.0.0.tgz'
    const v2Tarball = await buildModelTarball('2.0.0')
    const v2Url = 'https://fixtures.cradle.test/model-2.0.0.tgz'
    const downloadCenter = realDownloadCenter({ [v1Url]: v1Tarball, [v2Url]: v2Tarball })
    await downloadCenter.boot()

    const rootDir = path.join(tempRoot(), 'runtimes', 'image-ocr', 'ppocrv6-small')
    const service = new OcrModelInstallationService({
      downloadCenter,
      rootDir,
      env: {},
      target: fakeTarget('1.0.0', v1Url, sha512Hex(v1Tarball)),
      resolveBundle: noBundled,
      prepareManagedPathForRemoval: prepareOcrModelManagedPathForRemoval,
    })
    await service.boot()

    await expect(service.status()).resolves.toMatchObject({
      state: 'missing',
      errorCode: 'image_ocr_model_not_installed',
    })

    const installed = await service.install()
    expect(installed).toMatchObject({ state: 'ready', source: 'managed', version: '1.0.0' })
    expect(installed.installedSizeBytes).toBeGreaterThan(0)

    const bundle = resolveOcrModelBundle({ env: {}, rootDir, bundledPath: null })
    expect(bundle).toMatchObject({ source: 'managed', version: '1.0.0', managed: true })
    expect(bundle!.path).toBe(path.join(rootDir, 'versions', '1.0.0', 'bundle'))

    // An engine leasing the managed bundle is closed before removal proceeds.
    let engineClosed = false
    registerOcrEngineLease(bundle!.path!, async () => {
      engineClosed = true
    })
    await expect(service.uninstall()).resolves.toMatchObject({ managedInstalled: false })
    expect(engineClosed).toBe(true)

    // A newer release installs cleanly and flips the current pointer.
    const serviceV2 = new OcrModelInstallationService({
      downloadCenter,
      rootDir,
      env: {},
      target: fakeTarget('2.0.0', v2Url, sha512Hex(v2Tarball)),
      resolveBundle: noBundled,
    })
    await serviceV2.boot()
    await expect(serviceV2.status()).resolves.toMatchObject({ state: 'missing' })
    const updated = await serviceV2.install()
    expect(updated).toMatchObject({ state: 'ready', source: 'managed', version: '2.0.0' })
    expect(resolveOcrModelBundle({ env: {}, rootDir, bundledPath: null }))
      .toMatchObject({ source: 'managed', version: '2.0.0' })

    await service.shutdown()
    await serviceV2.shutdown()
    await downloadCenter.shutdown()
  })

  it('fails closed on a checksum mismatch and leaves the resource missing', async () => {
    const tarball = await buildModelTarball('1.0.0')
    const url = 'https://fixtures.cradle.test/model-1.0.0.tgz'
    const downloadCenter = realDownloadCenter({ [url]: tarball })
    await downloadCenter.boot()

    const rootDir = path.join(tempRoot(), 'runtimes', 'image-ocr', 'ppocrv6-small')
    const service = new OcrModelInstallationService({
      downloadCenter,
      rootDir,
      env: {},
      target: fakeTarget('1.0.0', url, '0'.repeat(128)),
      resolveBundle: noBundled,
    })
    await service.boot()
    await expect(service.install()).rejects.toThrow()
    await expect(service.status()).resolves.toMatchObject({ managedInstalled: false })
    await service.shutdown()
    await downloadCenter.shutdown()
  })

  it('refuses install while the configured bundle override is active', async () => {
    const downloadCenter = realDownloadCenter({})
    await downloadCenter.boot()
    const service = new OcrModelInstallationService({
      downloadCenter,
      rootDir: tempRoot(),
      env: { [LIGHT_OCR_BUNDLE_PATH_ENV]: '/operator/bundle' },
      target: fakeTarget('1.0.0', 'https://fixtures.cradle.test/unused.tgz', '0'.repeat(128)),
    })
    await service.boot()
    expect(() => service.install()).toThrow(expect.objectContaining({ code: 'image_ocr_model_override_active' }))
    await service.shutdown()
    await downloadCenter.shutdown()
  })
})
