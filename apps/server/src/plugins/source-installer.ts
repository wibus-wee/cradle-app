import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { PluginSource } from '@cradle/db'
import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import * as tar from 'tar'

import { getServerConfig } from '../infra'

const execFileAsync = promisify(execFile)
const DEFAULT_GITHUB_REF = 'main'
const DEFAULT_NPM_REF = 'latest'
const CACHE_DIR_NAME = 'plugin-sources-cache'
const MAX_GITHUB_TARBALL_BYTES = 64 * 1024 * 1024

export interface PluginSourceInstallerOptions {
  downloadCenter?: PluginSourceDownloadCenter
}

export interface PluginSourceDownloadCenter {
  execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
  release: (taskId: string) => Promise<unknown>
}

const sourceOperations = new Map<string, Promise<void>>()

export function sourceCacheKey(source: PluginSource): string {
  return createHash('sha256')
    .update(JSON.stringify({
      kind: source.kind,
      location: source.location,
      ref: source.ref ?? null,
      subPath: source.subPath ?? null,
    }))
    .digest('hex')
}

function cacheRoot(): string {
  const config = getServerConfig()
  const dataDir = config.dataDir ?? dirname(config.dbPath)
  return resolve(dataDir, CACHE_DIR_NAME)
}

function cacheDirForSource(source: PluginSource): string {
  return resolve(cacheRoot(), sourceCacheKey(source))
}

function validateRelativeSubPath(subPath: string | null): string | null {
  const value = subPath?.trim()
  if (!value || value === '.') { return null }
  if (value.includes('\\') || value.startsWith('/') || value.endsWith('/')) {
    throw new Error('Plugin source subPath must be a normalized relative path.')
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Plugin source subPath must not contain empty or traversal segments.')
  }
  return value
}

function validateGitHubRepository(repository: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Git plugin source location must use owner/name syntax.')
  }
}

function validateNpmPackageName(packageName: string): void {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
    throw new Error('Npm plugin source location must be a valid package name.')
  }
}

function packageDirectoryName(source: PluginSource): string {
  return source.location
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .replace(/[^\w.-]/g, '-')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function publishCache(stagingDir: string, cacheDir: string): Promise<void> {
  const backupDir = `${cacheDir}.previous-${Date.now()}`
  await rm(backupDir, { recursive: true, force: true })
  try {
    await rename(cacheDir, backupDir)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  try {
    await rename(stagingDir, cacheDir)
    await rm(backupDir, { recursive: true, force: true })
  }
  catch (error) {
    await rm(cacheDir, { recursive: true, force: true })
    try {
      await rename(backupDir, cacheDir)
    }
    catch {
      // The previous cache may not have existed.
    }
    throw error
  }
}

async function normalizeDiscoveryRoot(contentDir: string, source: PluginSource): Promise<string> {
  if (!await pathExists(resolve(contentDir, 'package.json'))) {
    return contentDir
  }

  const packagesDir = resolve(dirname(contentDir), 'packages')
  const packageDir = resolve(packagesDir, packageDirectoryName(source))
  await mkdir(packagesDir, { recursive: true })
  await rm(packageDir, { recursive: true, force: true })
  await rename(contentDir, packageDir)
  return packagesDir
}

function githubTarballDownloadRequest(source: PluginSource): DownloadRequest {
  validateGitHubRepository(source.location)
  const [owner, repo] = source.location.split('/')
  const ref = source.ref?.trim() || DEFAULT_GITHUB_REF
  const cacheKey = sourceCacheKey(source)
  return {
    owner: {
      namespace: 'plugins',
      resourceType: 'source-archive',
      resourceId: cacheKey,
      displayName: `GitHub plugin source ${source.location}`,
    },
    fileName: `plugin-source-${cacheKey}.tar.gz`,
    sources: [{
      id: `github:${source.location}@${ref}`,
      url: `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`,
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'Cradle-Server-Plugin-Source-Installer',
      },
    }],
    maxBytes: MAX_GITHUB_TARBALL_BYTES,
  }
}

async function downloadGitHubTarball(
  source: PluginSource,
  options: PluginSourceInstallerOptions,
): Promise<DownloadedArtifact> {
  if (!options.downloadCenter) {
    throw new Error('Plugin source resolution requires the server Download Center.')
  }
  return options.downloadCenter.execute(githubTarballDownloadRequest(source))
}

async function extractGitSource(source: PluginSource, archivePath: string, contentDir: string): Promise<void> {
  const requestedPath = validateRelativeSubPath(source.subPath)
  const stripSegments = requestedPath ? requestedPath.split('/').length + 1 : 1
  let matched = false

  await tar.x({
    file: archivePath,
    cwd: contentDir,
    strip: stripSegments,
    filter(entryPath) {
      const normalized = entryPath.replace(/\\/g, '/')
      const slashIndex = normalized.indexOf('/')
      if (slashIndex < 0) { return false }
      if (!requestedPath) {
        matched = true
        return true
      }
      const relativePath = normalized.slice(slashIndex + 1).replace(/\/$/, '')
      const include = relativePath === requestedPath || relativePath.startsWith(`${requestedPath}/`)
      matched ||= include
      return include
    },
  })

  if (!matched) {
    throw new Error(`Plugin source path ${requestedPath ?? '.'} was not found in ${source.location}@${source.ref ?? DEFAULT_GITHUB_REF}.`)
  }
}

async function packNpmSource(source: PluginSource, archiveDir: string): Promise<string> {
  validateNpmPackageName(source.location)
  const specifier = `${source.location}@${source.ref?.trim() || DEFAULT_NPM_REF}`
  const { stdout } = await execFileAsync('npm', ['pack', specifier, '--pack-destination', archiveDir])
  const packedFile = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1)
  if (!packedFile) {
    const entries = await readdir(archiveDir)
    const fallback = entries.find(entry => entry.endsWith('.tgz'))
    if (!fallback) {
      throw new Error(`npm pack did not produce an archive for ${specifier}.`)
    }
    return resolve(archiveDir, fallback)
  }
  return resolve(archiveDir, basename(packedFile))
}

async function installGitOrNpmSource(source: PluginSource, options: PluginSourceInstallerOptions): Promise<string> {
  const cacheDir = cacheDirForSource(source)
  const stagingDir = resolve(cacheRoot(), `${source.id}.staging-${process.pid}-${Date.now()}`)
  const contentDir = resolve(stagingDir, 'content')
  const archiveDir = resolve(stagingDir, 'archives')
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(contentDir, { recursive: true })
  await mkdir(archiveDir, { recursive: true })

  try {
    if (source.kind === 'git') {
      const artifact = await downloadGitHubTarball(source, options)
      try {
        await extractGitSource(source, artifact.filePath, contentDir)
      }
      finally {
        await options.downloadCenter!.release(artifact.taskId)
      }
    }
    else {
      const archivePath = await packNpmSource(source, archiveDir)
      await tar.x({
        file: archivePath,
        cwd: contentDir,
        strip: 1,
      })
    }

    const discoveryRoot = await normalizeDiscoveryRoot(contentDir, source)
    const discoveryRootName = basename(discoveryRoot)
    await publishCache(stagingDir, cacheDir)
    return resolve(cacheDir, discoveryRootName)
  }
  catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

async function withSourceOperation<T>(source: PluginSource, operation: () => Promise<T>): Promise<T> {
  const key = sourceCacheKey(source)
  const prior = sourceOperations.get(key)
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  sourceOperations.set(key, current)
  await prior?.catch(() => undefined)
  try {
    return await operation()
  }
  finally {
    release()
    if (sourceOperations.get(key) === current) {
      sourceOperations.delete(key)
    }
  }
}

/**
 * Reads the local source cache only. It never downloads, extracts, publishes,
 * or invokes npm, so it is safe for GET projections and startup discovery.
 */
export async function inspectPluginSourceDirectory(source: PluginSource): Promise<string | null> {
  if (source.kind === 'localPath') {
    const localPath = resolve(source.location)
    if (localPath !== source.location) {
      throw new Error('Local plugin source location must be an absolute path.')
    }
    return await pathExists(localPath) ? localPath : null
  }

  const existingPackageRoot = resolve(cacheDirForSource(source), 'packages')
  if (await pathExists(existingPackageRoot)) {
    return existingPackageRoot
  }
  const existingContentRoot = resolve(cacheDirForSource(source), 'content')
  return await pathExists(existingContentRoot) ? existingContentRoot : null
}

export async function resolvePluginSourceDirectory(
  source: PluginSource,
  options: PluginSourceInstallerOptions = {},
): Promise<string> {
  if (source.kind === 'localPath') {
    const localPath = resolve(source.location)
    if (localPath !== source.location) {
      throw new Error('Local plugin source location must be an absolute path.')
    }
    return localPath
  }

  return withSourceOperation(source, async () => {
    const cached = await inspectPluginSourceDirectory(source)
    return cached ?? installGitOrNpmSource(source, options)
  })
}

export async function refreshPluginSourceDirectory(
  source: PluginSource,
  options: PluginSourceInstallerOptions = {},
): Promise<string> {
  if (source.kind === 'localPath') {
    return resolvePluginSourceDirectory(source, options)
  }
  return withSourceOperation(source, async () => {
    await rm(cacheDirForSource(source), { recursive: true, force: true })
    return installGitOrNpmSource(source, options)
  })
}

export async function deletePluginSourceCache(source: PluginSource): Promise<void> {
  if (source.kind !== 'localPath') {
    await withSourceOperation(source, async () => {
      await rm(cacheDirForSource(source), { recursive: true, force: true })
    })
  }
}
