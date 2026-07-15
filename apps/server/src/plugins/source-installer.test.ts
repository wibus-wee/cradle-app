import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import type { PluginSource } from '@cradle/db'
import { DownloadError } from '@cradle/download-center'
import * as tar from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PluginSourceDownloadCenter } from './source-installer'
import {
  inspectPluginSourceDirectory,
  refreshPluginSourceDirectory,
  resolvePluginSourceDirectory,
} from './source-installer'

const tempRoots: string[] = []

function source(input: Partial<PluginSource> & Pick<PluginSource, 'kind' | 'location'>): PluginSource {
  return {
    id: input.id ?? `source-${crypto.randomUUID()}`,
    kind: input.kind,
    location: input.location,
    ref: input.ref ?? null,
    subPath: input.subPath ?? null,
    label: input.label ?? null,
    addedReason: input.addedReason ?? 'test',
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt ?? 1,
  }
}

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writePluginPackage(root: string, relativePath: string, packageName: string): Promise<string> {
  const packageDir = resolve(root, relativePath)
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    resolve(packageDir, 'package.json'),
    `${JSON.stringify({
      name: packageName,
      version: '1.0.0',
      type: 'module',
      cradle: {
        apiVersion: '1',
        server: 'server.mjs',
        contributes: {
          capabilities: [],
          permissions: [],
        },
      },
    }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(resolve(packageDir, 'server.mjs'), 'export function activate() {}\n', 'utf8')
  return packageDir
}

async function createArchivePath(root: string, entry: string): Promise<string> {
  const archivePath = resolve(root, `${entry}.tgz`)
  await tar.c({ cwd: root, file: archivePath, gzip: true }, [entry])
  return archivePath
}

function downloadCenterForArchive(archivePath: string): PluginSourceDownloadCenter & {
  execute: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
} {
  const execute = vi.fn(async () => ({
    taskId: 'download-task',
    filePath: archivePath,
    bytes: (await readFile(archivePath)).byteLength,
    checksum: { algorithm: 'sha256' as const, expected: null, actual: 'test', matched: null },
  }))
  const release = vi.fn(async () => undefined)
  return { execute, release }
}

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('plugin source installer', () => {
  const originalDataDir = process.env.CRADLE_DATA_DIR
  const originalDbPath = process.env.CRADLE_DB_PATH
  const originalPath = process.env.PATH

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = originalDataDir
    }
    if (originalDbPath === undefined) {
      delete process.env.CRADLE_DB_PATH
    }
    else {
      process.env.CRADLE_DB_PATH = originalDbPath
    }
    process.env.PATH = originalPath
    for (const root of tempRoots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns an absolute local source path unchanged', async () => {
    const root = await tempRoot('cradle-source-local-')

    await expect(resolvePluginSourceDirectory(source({
      kind: 'localPath',
      location: root,
    }))).resolves.toBe(root)
  })

  it('downloads GitHub tarballs through the Download Center with a compressed byte limit', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    const archiveRoot = await tempRoot('cradle-source-git-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    const repoRoot = resolve(archiveRoot, 'acme-plugin-pack-testref')
    await writePluginPackage(repoRoot, '.', '@acme/git-plugin')
    const archivePath = await createArchivePath(archiveRoot, 'acme-plugin-pack-testref')
    const downloadCenter = downloadCenterForArchive(archivePath)

    const discoveryDir = await resolvePluginSourceDirectory(source({
      id: 'git-source',
      kind: 'git',
      location: 'acme/plugin-pack',
      ref: 'testref',
    }), { downloadCenter })

    expect(downloadCenter.execute).toHaveBeenCalledOnce()
    expect(downloadCenter.execute).toHaveBeenCalledWith(expect.objectContaining({
      owner: expect.objectContaining({
        namespace: 'plugins',
        resourceType: 'source-archive',
      }),
      fileName: expect.stringMatching(/^plugin-source-[a-f0-9]{64}\.tar\.gz$/),
      maxBytes: 64 * 1024 * 1024,
      sources: [expect.objectContaining({
        id: 'github:acme/plugin-pack@testref',
        url: 'https://api.github.com/repos/acme/plugin-pack/tarball/testref',
      })],
    }))
    expect(downloadCenter.release).toHaveBeenCalledWith('download-task')
    const entries = await readFile(resolve(discoveryDir, 'acme-plugin-pack', 'package.json'), 'utf8')
    expect(JSON.parse(entries)).toMatchObject({ name: '@acme/git-plugin' })
  })

  it('inspects missing caches without resolving a source', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH

    await expect(inspectPluginSourceDirectory(source({
      kind: 'git',
      location: 'acme/missing-plugin',
    }))).resolves.toBeNull()
  })

  it('shares one GitHub download and cache publication across concurrent resolves', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    const archiveRoot = await tempRoot('cradle-source-git-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    const repoRoot = resolve(archiveRoot, 'acme-plugin-pack-main')
    await writePluginPackage(repoRoot, '.', '@acme/git-plugin')
    const archivePath = await createArchivePath(archiveRoot, 'acme-plugin-pack-main')
    const downloadCenter = downloadCenterForArchive(archivePath)
    const first = source({ id: 'preview', kind: 'git', location: 'acme/plugin-pack' })
    const second = source({ id: 'installed', kind: 'git', location: 'acme/plugin-pack' })

    const [firstDirectory, secondDirectory] = await Promise.all([
      resolvePluginSourceDirectory(first, { downloadCenter }),
      resolvePluginSourceDirectory(second, { downloadCenter }),
    ])

    expect(firstDirectory).toBe(secondDirectory)
    expect(downloadCenter.execute).toHaveBeenCalledOnce()
    expect(downloadCenter.release).toHaveBeenCalledOnce()
  })

  it('waits to refresh until an active resolve publishes, then leaves the refresh result cached', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    const archiveRoot = await tempRoot('cradle-source-git-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    const resolveRoot = resolve(archiveRoot, 'acme-plugin-pack-resolve')
    const refreshRoot = resolve(archiveRoot, 'acme-plugin-pack-refresh')
    await writePluginPackage(resolveRoot, '.', '@acme/git-plugin')
    await writePluginPackage(refreshRoot, '.', '@acme/git-plugin')
    await writeFile(resolve(refreshRoot, 'package.json'), JSON.stringify({
      name: '@acme/git-plugin',
      version: '2.0.0',
      type: 'module',
      cradle: { apiVersion: '1', server: 'server.mjs', contributes: { capabilities: [], permissions: [] } },
    }))
    const resolveArchive = await createArchivePath(archiveRoot, 'acme-plugin-pack-resolve')
    const refreshArchive = await createArchivePath(archiveRoot, 'acme-plugin-pack-refresh')
    const resolveStarted = deferred<void>()
    const allowResolve = deferred<void>()
    let executions = 0
    const downloadCenter: PluginSourceDownloadCenter = {
      execute: async () => {
        executions += 1
        if (executions === 1) {
          resolveStarted.resolve()
          await allowResolve.promise
        }
        const archivePath = executions === 1 ? resolveArchive : refreshArchive
        return {
          taskId: `download-${executions}`,
          filePath: archivePath,
          bytes: (await readFile(archivePath)).byteLength,
          checksum: { algorithm: 'sha256', expected: null, actual: 'test', matched: null },
        }
      },
      release: async () => undefined,
    }
    const pluginSource = source({ kind: 'git', location: 'acme/plugin-pack' })

    const resolving = resolvePluginSourceDirectory(pluginSource, { downloadCenter })
    await resolveStarted.promise
    const refreshing = refreshPluginSourceDirectory(pluginSource, { downloadCenter })
    await Promise.resolve()
    expect(executions).toBe(1)
    allowResolve.resolve()
    const [, refreshedDirectory] = await Promise.all([resolving, refreshing])

    expect(executions).toBe(2)
    expect(JSON.parse(await readFile(resolve(refreshedDirectory, 'acme-plugin-pack', 'package.json'), 'utf8'))).toMatchObject({
      version: '2.0.0',
    })
  })

  it('surfaces Download Center byte-limit failures before extraction', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    const downloadCenter: PluginSourceDownloadCenter = {
      execute: async () => { throw new DownloadError('byte_limit_exceeded', false) },
      release: async () => undefined,
    }

    await expect(resolvePluginSourceDirectory(source({
      kind: 'git',
      location: 'acme/oversized-plugin',
    }), { downloadCenter })).rejects.toMatchObject({ code: 'byte_limit_exceeded' })
  })

  it('extracts npm pack output through a local fake npm executable', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    const packageRoot = await tempRoot('cradle-source-npm-package-')
    const binRoot = await tempRoot('cradle-source-npm-bin-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    await writePluginPackage(resolve(packageRoot, 'package'), '.', '@acme/npm-plugin')
    const archivePath = await createArchivePath(packageRoot, 'package')
    const npmPath = resolve(binRoot, 'npm')
    await writeFile(
      npmPath,
      [
        '#!/bin/sh',
        'set -eu',
        'destination="$4"',
        `cp ${JSON.stringify(archivePath)} "$destination/acme-npm-plugin-1.0.0.tgz"`,
        'printf "%s\\n" "acme-npm-plugin-1.0.0.tgz"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    process.env.PATH = `${binRoot}${delimiter}${originalPath}`

    const discoveryDir = await resolvePluginSourceDirectory(source({
      id: 'npm-source',
      kind: 'npm',
      location: '@acme/npm-plugin',
      ref: '1.0.0',
    }))

    const rawPackageJson = await readFile(resolve(discoveryDir, 'acme-npm-plugin', 'package.json'), 'utf8')
    expect(JSON.parse(rawPackageJson)).toMatchObject({ name: '@acme/npm-plugin' })
  })
})
