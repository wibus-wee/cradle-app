import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { PluginSource } from '@cradle/db'
import type { DownloadExecution, DownloadExecutionResult } from '@cradle/download-center'
import * as tar from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerContractApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
import { DownloadCenterService } from '../src/modules/download-center/service'
import { deactivateAllPlugins } from '../src/plugins/loader'
import { sourceCacheKey } from '../src/plugins/source-installer'
import { addPluginSource } from '../src/plugins/source-registry'

const renameCalls = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    rename: (...args: Parameters<typeof original.rename>) => {
      renameCalls(...args)
      return original.rename(...args)
    },
  }
})

class PluginArchiveDownloader {
  readonly executions: DownloadExecution[] = []

  constructor(
    private readonly rootDir: string,
    private readonly archivePath: string,
  ) {}

  async download(execution: DownloadExecution): Promise<DownloadExecutionResult> {
    this.executions.push(execution)
    await new Promise<void>(resolvePromise => setTimeout(resolvePromise, 10))
    const artifactPath = join(this.rootDir, 'artifacts', execution.taskId, execution.request.fileName)
    await mkdir(resolve(artifactPath, '..'), { recursive: true })
    await copyFile(this.archivePath, artifactPath)
    return {
      sourceId: execution.request.sources[0]!.id,
      etag: null,
      artifact: {
        taskId: execution.taskId,
        filePath: artifactPath,
        bytes: (await readFile(artifactPath)).byteLength,
        checksum: { algorithm: 'sha256', expected: null, actual: 'a'.repeat(64), matched: null },
      },
    }
  }
}

async function createPluginArchive(root: string): Promise<string> {
  const packageRoot = join(root, 'acme-plugin-source-main')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@acme/plugin-source',
    version: '1.0.0',
    type: 'module',
    cradle: {
      apiVersion: '1',
      contributes: { capabilities: [], permissions: [] },
    },
  }))
  const archivePath = join(root, 'plugin-source.tgz')
  await tar.c({ cwd: root, file: archivePath, gzip: true }, ['acme-plugin-source-main'])
  return archivePath
}

function sourceInput(): { kind: 'git', location: string, ref: string } {
  return { kind: 'git', location: 'acme/plugin-source', ref: 'main' }
}

function requestJson(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('plugin source HTTP operations', () => {
  let dataDir: string
  let archiveRoot: string

  beforeEach(async () => {
    renameCalls.mockClear()
    dataDir = await mkdtemp(join(tmpdir(), 'cradle-plugin-sources-data-'))
    archiveRoot = await mkdtemp(join(tmpdir(), 'cradle-plugin-sources-archive-'))
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await deactivateAllPlugins()
    shutdownInfra()
    await rm(dataDir, { recursive: true, force: true })
    await rm(archiveRoot, { recursive: true, force: true })
    delete process.env.CRADLE_DATA_DIR
  })

  it('keeps source list and get cache-only when a persisted Git source is unresolved', async () => {
    const archivePath = await createPluginArchive(archiveRoot)
    const downloader = new PluginArchiveDownloader(join(dataDir, 'downloads'), archivePath)
    const downloadCenter = new DownloadCenterService({ downloader, rootDir: join(dataDir, 'downloads') })
    const source = addPluginSource(sourceInput())
    const app = await createServerContractApp({ includeRuntimeHttpPlugins: true, downloadCenterService: downloadCenter })

    const listResponse = await app.handle(new Request('http://localhost/plugins/sources'))
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json() as Array<{ id: string, resolvedDirectory: string | null, error: string | null }>
    expect(list).toContainEqual(expect.objectContaining({
      id: source.id,
      resolvedDirectory: null,
      error: expect.stringContaining('unresolved'),
    }))

    const getResponse = await app.handle(new Request(`http://localhost/plugins/sources/${source.id}`))
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toMatchObject({
      id: source.id,
      resolvedDirectory: null,
      error: expect.stringContaining('unresolved'),
    })
    expect(downloader.executions).toHaveLength(0)
    expect(downloadCenter.list()).toHaveLength(0)
  })

  it('shares one download and cache publication across concurrent preview and create', async () => {
    const archivePath = await createPluginArchive(archiveRoot)
    const downloadsRoot = join(dataDir, 'downloads')
    const downloader = new PluginArchiveDownloader(downloadsRoot, archivePath)
    const downloadCenter = new DownloadCenterService({ downloader, rootDir: downloadsRoot })
    const app = await createServerContractApp({ includeRuntimeHttpPlugins: true, downloadCenterService: downloadCenter })
    const cacheKey = sourceCacheKey({
      id: 'cache-key-projection',
      ...sourceInput(),
      subPath: null,
      label: null,
      addedReason: 'test',
      createdAt: 0,
      updatedAt: 0,
    } satisfies PluginSource)
    const cacheDir = join(dataDir, 'plugin-sources-cache', cacheKey)

    const [previewResponse, createResponse] = await Promise.all([
      app.handle(requestJson('/plugins/sources/preview', sourceInput())),
      app.handle(requestJson('/plugins/sources', sourceInput())),
    ])

    expect(previewResponse.status).toBe(200)
    expect(createResponse.status).toBe(200)
    expect(downloader.executions).toHaveLength(1)
    expect(downloadCenter.list()).toHaveLength(1)
    const created = await createResponse.json() as { source: { id: string, resolvedDirectory: string | null } }
    expect(created.source.resolvedDirectory).toContain('plugin-sources-cache')
    const cachePublications = renameCalls.mock.calls.filter(([from, to]) =>
      String(to) === cacheDir && String(from).includes('.staging-'))
    expect(cachePublications).toHaveLength(1)
    const cachedPackage = join(cacheDir, 'packages', 'acme-plugin-source', 'package.json')
    await expect(readFile(cachedPackage, 'utf8')).resolves.toContain('@acme/plugin-source')
  })

  it('reuses a preview cache when the source is created afterwards', async () => {
    const archivePath = await createPluginArchive(archiveRoot)
    const downloadsRoot = join(dataDir, 'downloads')
    const downloader = new PluginArchiveDownloader(downloadsRoot, archivePath)
    const downloadCenter = new DownloadCenterService({ downloader, rootDir: downloadsRoot })
    const app = await createServerContractApp({ includeRuntimeHttpPlugins: true, downloadCenterService: downloadCenter })

    const previewResponse = await app.handle(requestJson('/plugins/sources/preview', sourceInput()))
    expect(previewResponse.status).toBe(200)
    const createResponse = await app.handle(requestJson('/plugins/sources', sourceInput()))
    expect(createResponse.status).toBe(200)

    expect(downloader.executions).toHaveLength(1)
    expect(downloadCenter.list()).toHaveLength(1)
  })
})
