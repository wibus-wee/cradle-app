import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import type { PluginSource } from '@cradle/db'
import * as tar from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolvePluginSourceDirectory } from './source-installer'

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

async function createArchive(root: string, entry: string): Promise<Buffer> {
  return readFile(await createArchivePath(root, entry))
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

  it('downloads and extracts a GitHub source without network access', async () => {
    const dataDir = await tempRoot('cradle-source-data-')
    const archiveRoot = await tempRoot('cradle-source-git-')
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    const repoRoot = resolve(archiveRoot, 'acme-plugin-pack-testref')
    await writePluginPackage(repoRoot, '.', '@acme/git-plugin')
    const archive = await createArchive(archiveRoot, 'acme-plugin-pack-testref')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))
    vi.stubGlobal('fetch', fetchMock)

    const discoveryDir = await resolvePluginSourceDirectory(source({
      id: 'git-source',
      kind: 'git',
      location: 'acme/plugin-pack',
      ref: 'testref',
    }))

    expect(fetchMock).toHaveBeenCalledOnce()
    const entries = await readFile(resolve(discoveryDir, 'acme-plugin-pack', 'package.json'), 'utf8')
    expect(JSON.parse(entries)).toMatchObject({ name: '@acme/git-plugin' })
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
