import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DownloadRequest } from '@cradle/download-center'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LIGHT_OCR_BUNDLE_PATH_ENV, resolveOcrModelBundle } from './model-bundle'
import type { OcrModelDownloadCenter } from './model-installation'
import { OcrModelInstallationService } from './model-installation'
import { resolveOcrModelRelease } from './model-release'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-ocr-model-'))
  tempRoots.push(root)
  return root
}

function fakeDownloadCenter() {
  const requests: DownloadRequest[] = []
  const service: OcrModelDownloadCenter = {
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

function fakeExtractBundle() {
  return async (_archivePath: string, _target: unknown, destination: string) => {
    const bundleDir = path.join(destination, 'package', 'bundle')
    await mkdir(bundleDir, { recursive: true })
    await writeFile(path.join(bundleDir, 'manifest.json'), '{}', 'utf8')
    return bundleDir
  }
}

function noBundle(input: Parameters<typeof resolveOcrModelBundle>[0]) {
  return resolveOcrModelBundle({ ...input, bundledPath: null })
}

describe('ocrModelInstallationService', () => {
  it('installs the model tarball with the catalog identity and resolves the managed bundle', async () => {
    const rootDir = tempRoot()
    const target = resolveOcrModelRelease()
    const download = fakeDownloadCenter()
    const prepareRemoval = vi.fn(async () => true)
    const service = new OcrModelInstallationService({
      downloadCenter: download.service,
      rootDir,
      env: {},
      target,
      resolveBundle: noBundle,
      prepareManagedPathForRemoval: prepareRemoval,
      extractBundle: fakeExtractBundle(),
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
      fileName: `light-ocr-model-ppocrv6-small-${target.version}.tgz`,
      owner: {
        namespace: 'image-ocr',
        resourceType: 'model',
        resourceId: 'ppocrv6-small',
        displayName: 'Light OCR model',
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
    const target = resolveOcrModelRelease()
    const override = new OcrModelInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir: tempRoot(),
      env: { [LIGHT_OCR_BUNDLE_PATH_ENV]: '/operator/bundle' },
      target,
    })
    expect(() => override.install()).toThrow(expect.objectContaining({ code: 'image_ocr_model_override_active' }))

    const service = new OcrModelInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir: tempRoot(),
      env: {},
      target,
      resolveBundle: noBundle,
      prepareManagedPathForRemoval: vi.fn(async () => false),
      extractBundle: fakeExtractBundle(),
    })
    await service.boot()
    await service.install()
    await expect(service.uninstall()).rejects.toMatchObject({ code: 'image_ocr_model_in_use' })
  })

  it('releases the Download Center artifact and retains error state when extraction fails', async () => {
    const target = resolveOcrModelRelease()
    const download = fakeDownloadCenter()
    const service = new OcrModelInstallationService({
      downloadCenter: download.service,
      rootDir: tempRoot(),
      env: {},
      target,
      resolveBundle: noBundle,
      extractBundle: vi.fn(async () => { throw new Error('unsafe archive') }),
    })
    await service.boot()
    await expect(service.install()).rejects.toThrow('unsafe archive')
    expect(download.service.release).toHaveBeenCalledTimes(1)
    await expect(service.status()).resolves.toMatchObject({
      state: 'error',
      errorCode: 'image_ocr_model_install_failed',
    })
  })

  it('reports missing when nothing resolves and bundled/configured as external sources', async () => {
    const target = resolveOcrModelRelease()
    const rootDir = tempRoot()
    const service = new OcrModelInstallationService({
      downloadCenter: fakeDownloadCenter().service,
      rootDir,
      env: {},
      target,
      resolveBundle: noBundle,
    })
    await service.boot()
    await expect(service.status()).resolves.toMatchObject({
      state: 'missing',
      errorCode: 'image_ocr_model_not_installed',
    })

    expect(resolveOcrModelBundle({ env: {}, rootDir, bundledPath: '/pkg/bundle' }))
      .toMatchObject({ source: 'bundled', path: null })
  })
})
